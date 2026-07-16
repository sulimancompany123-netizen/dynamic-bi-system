
import argparse
import hashlib
import json
import math
import os
import re
import sys
from typing import Any, Dict, List, Optional

import pandas as pd
import base64
import io
import warnings

# Excel readers (openpyxl/calamine) emit UserWarnings to stderr for many real-world
# workbooks (data validations, unsupported extensions, default styles...). In daemon
# mode an unread stderr pipe can fill up and deadlock the process, so silence them.
warnings.simplefilter('ignore')

sys.stdout.reconfigure(encoding='utf-8')

HAS_PARQUET = False
HAS_PYARROW = False
try:
    import pyarrow
    HAS_PARQUET = True
    HAS_PYARROW = True
except ImportError:
    try:
        import fastparquet
        HAS_PARQUET = True
    except ImportError:
        pass

HAS_CALAMINE = False
try:
    from python_calamine import CalamineWorkbook  # noqa: F401
    HAS_CALAMINE = True
except ImportError:
    pass


def get_cache_path(path: str, sheet: str, cache_dir: str) -> Optional[str]:
    if not cache_dir:
        return None
    raw = path + "::" + (sheet or "")
    key = hashlib.md5(raw.encode('utf-8')).hexdigest()
    os.makedirs(cache_dir, exist_ok=True)
    if HAS_PARQUET:
        return os.path.join(cache_dir, f"{key}.parquet")
    else:
        return os.path.join(cache_dir, f"{key}.pkl")


def is_cache_valid(cache_path: str, source_path: str) -> bool:
    if not os.path.exists(cache_path):
        return False
    try:
        source_mtime = os.path.getmtime(source_path)
        cache_mtime = os.path.getmtime(cache_path)
        return cache_mtime >= source_mtime
    except OSError:
        return False


def save_cache(df: pd.DataFrame, cache_path: str):
    try:
        if HAS_PARQUET:
            _safe_to_parquet(df, cache_path)
        else:
            df.to_pickle(cache_path)
    except Exception:
        pass


def load_dataframe(path: str, sheet: str = None, cache_dir: str = None) -> pd.DataFrame:
    if path.endswith('.parquet'):
        return pd.read_parquet(path)
    cache_path = get_cache_path(path, sheet, cache_dir) if cache_dir else None
    if cache_path and is_cache_valid(cache_path, path):
        try:
            if HAS_PARQUET:
                return pd.read_parquet(cache_path)
            else:
                return pd.read_pickle(cache_path)
        except Exception:
            try:
                os.remove(cache_path)
            except OSError:
                pass
    if path.endswith('.csv'):
        df = pd.read_csv(path)
    else:
        read_kwargs = {}
        if HAS_CALAMINE:
            read_kwargs['engine'] = 'calamine'
        if sheet:
            read_kwargs['sheet_name'] = sheet
        try:
            df = pd.read_excel(path, **read_kwargs)
        except Exception:
            read_kwargs.pop('engine', None)
            df = pd.read_excel(path, **read_kwargs)
    df = drop_empty_columns(df)
    if cache_path:
        save_cache(df, cache_path)
    return df


def drop_empty_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.dropna(axis=1, how='all')
    empty_str_cols = [col for col in df.columns
                      if df[col].dtype == 'object'
                      and (df[col].fillna("") == "").all()]
    if empty_str_cols:
        df = df.drop(columns=empty_str_cols)
    return df


def _safe_to_parquet(df: pd.DataFrame, path: str):
    df = df.copy()
    for col in df.select_dtypes(include=['object']).columns:
        df[col] = df[col].astype(str)
    df.to_parquet(path, index=False)


_DATE_PATTERN = re.compile(
    r'^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}',
)


def diagnose_column_type(series: pd.Series) -> str:
    sample_size = min(len(series), 200)
    sample = series.head(sample_size)
    nunique_sample = sample.nunique()
    if nunique_sample > sample_size * 0.5:
        return "unique_id"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "date"
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    if series.dtype == 'object':
        if nunique_sample > sample_size * 0.2:
            return "categorical"
        first_vals = sample.dropna().head(5).astype(str).tolist()
        if any(_DATE_PATTERN.match(v) for v in first_vals):
            try:
                converted = pd.to_datetime(sample, errors='coerce')
                if converted.notna().sum() / max(sample.notna().sum(), 1) > 0.8:
                    return "date"
            except Exception:
                pass
    return "categorical"


def build_columns_summary(df: pd.DataFrame) -> List[Dict]:
    result = []
    sample_size = min(len(df), 200)
    df_sample = df.head(sample_size)
    for col in df.columns:
        col_type = diagnose_column_type(df[col])
        sample_values = df_sample[col].dropna().unique()[:2].tolist()
        sample_values = [str(v) for v in sample_values]
        result.append({"name": str(col), "type": col_type, "samples": sample_values})
    return result


MAX_PREVIEW_COLS = 50


def build_preview(df: pd.DataFrame) -> List[Dict]:
    preview_df = df.head(5)
    if len(preview_df.columns) > MAX_PREVIEW_COLS:
        preview_df = preview_df.iloc[:, :MAX_PREVIEW_COLS]
    return preview_df.fillna("").to_dict(orient="records")


def cmd_inspect(args: argparse.Namespace) -> Dict:
    path = args.path
    if path.endswith('.csv'):
        df = load_dataframe(path, cache_dir=args.cache_dir)
        return {
            "status": "success",
            "total_rows": len(df),
            "total_columns": len(df.columns),
            "columns": build_columns_summary(df),
            "preview": build_preview(df),
        }
    else:
        read_kwargs = {}
        if HAS_CALAMINE:
            read_kwargs['engine'] = 'calamine'
        try:
            xls = pd.ExcelFile(path, **read_kwargs)
        except Exception:
            read_kwargs.pop('engine', None)
            xls = pd.ExcelFile(path, **read_kwargs)
        sheets = xls.sheet_names
        if len(sheets) == 1:
            df = load_dataframe(path, sheet=sheets[0], cache_dir=args.cache_dir)
            return {
                "status": "success",
                "total_rows": len(df),
                "total_columns": len(df.columns),
                "columns": build_columns_summary(df),
                "preview": build_preview(df),
                "sheets": sheets,
            }
        else:
            return {
                "status": "success",
                "multi_sheet": True,
                "sheets": sheets,
            }


def cmd_sheet_data(args: argparse.Namespace) -> Dict:
    path = args.path
    sheet = args.sheet
    try:
        df = load_dataframe(path, sheet=sheet, cache_dir=args.cache_dir)
    except Exception as e:
        return {"status": "error", "detail": str(e)}
    return {
        "status": "success",
        "total_rows": len(df),
        "total_columns": len(df.columns),
        "columns": build_columns_summary(df),
        "preview": build_preview(df),
    }


def apply_filters(df: pd.DataFrame, filters: dict) -> pd.DataFrame:
    for col, val in filters.items():
        if col not in df.columns:
            continue
        if isinstance(val, dict):
            if 'min' in val or 'max' in val:
                if 'min' in val:
                    df = df[pd.to_numeric(df[col], errors='coerce') >= float(val['min'])]
                if 'max' in val:
                    df = df[pd.to_numeric(df[col], errors='coerce') <= float(val['max'])]
            elif 'selected' in val:
                sel = val['selected']
                if isinstance(sel, list) and len(sel) > 0:
                    df = df[df[col].astype(str).isin(sel)]
        elif isinstance(val, list):
            df = df[df[col].astype(str).isin(val)]
        else:
            df = df[df[col].astype(str) == str(val)]
    return df


def _row_matches_filters(row, filters: dict, columns: set) -> bool:
    for col, val in filters.items():
        if col not in columns:
            continue
        cell = row.get(col)
        cell_str = str(cell) if cell is not None else ""
        if isinstance(val, dict):
            if 'min' in val or 'max' in val:
                try:
                    num = float(cell) if cell is not None and cell != "" else None
                except (ValueError, TypeError):
                    num = None
                if 'min' in val and (num is None or num < float(val['min'])):
                    return False
                if 'max' in val and (num is None or num > float(val['max'])):
                    return False
            elif 'selected' in val:
                sel = val['selected']
                if isinstance(sel, list) and len(sel) > 0 and cell_str not in sel:
                    return False
        elif isinstance(val, list):
            if cell_str not in val:
                return False
        else:
            if cell_str != str(val):
                return False
    return True


def cmd_table_data(args: argparse.Namespace) -> Dict:
    path = args.path
    sheet = args.sheet
    filters_raw = getattr(args, 'filters', '{}')
    filters = json.loads(base64.b64decode(filters_raw).decode('utf-8')) if filters_raw else {}
    columns_raw = getattr(args, 'columns', '')
    columns = json.loads(base64.b64decode(columns_raw).decode('utf-8')) if columns_raw else None
    columns = columns if columns else None

    limit = 50

    try:
        if HAS_PARQUET and path.endswith('.parquet'):
            parquet_filters = _build_parquet_filters(filters)
            if HAS_PYARROW and not parquet_filters:
                import pyarrow.parquet as pq
                pf = pq.ParquetFile(path)
                data = pf.read(columns=columns).to_pandas()
                data_count = len(data)
                if data_count > limit:
                    out = data.iloc[:limit].fillna("").to_dict(orient="records")
                    total_filtered = -1
                else:
                    out = data.fillna("").to_dict(orient="records")
                    total_filtered = data_count
                return {
                    "status": "success",
                    "total_filtered_rows": total_filtered,
                    "data": out,
                }
            elif parquet_filters:
                df = pd.read_parquet(path, filters=parquet_filters, columns=columns)
            else:
                df = pd.read_parquet(path, columns=columns)
        else:
            df = load_dataframe(path, sheet=sheet, cache_dir=args.cache_dir)
            if columns is not None:
                df = df[[c for c in columns if c in df.columns]]
    except Exception as e:
        return {"status": "error", "detail": str(e)}

    if HAS_PARQUET and path.endswith('.parquet'):
        data_count = len(df)
        if data_count > limit:
            data = df.iloc[:limit].fillna("").to_dict(orient="records")
            total_filtered = -1
        else:
            data = df.fillna("").to_dict(orient="records")
            total_filtered = data_count
    else:
        mask = pd.Series([True] * len(df))
        col_set = set(df.columns)
        for col, val in filters.items():
            if col not in col_set:
                continue
            if isinstance(val, dict):
                if 'min' in val or 'max' in val:
                    numeric = pd.to_numeric(df[col], errors='coerce')
                    if 'min' in val:
                        mask &= (numeric >= float(val['min']))
                    if 'max' in val:
                        mask &= (numeric <= float(val['max']))
                elif 'selected' in val:
                    sel = val['selected']
                    if isinstance(sel, list) and len(sel) > 0:
                        mask &= df[col].astype(str).isin(sel)
            elif isinstance(val, list):
                mask &= df[col].astype(str).isin(val)
            else:
                mask &= df[col].astype(str) == str(val)

        matching_rows = df.loc[mask]
        data_count = len(matching_rows)
        if data_count > limit:
            data = matching_rows.iloc[:limit].fillna("").to_dict(orient="records")
            total_filtered = -1
        else:
            data = matching_rows.fillna("").to_dict(orient="records")
            total_filtered = data_count

    return {
        "status": "success",
        "total_filtered_rows": total_filtered,
        "data": data,
    }


def _build_parquet_filters(filters: dict) -> list:
    parquet_filters = []
    for col, val in filters.items():
        if isinstance(val, dict):
            if 'min' in val or 'max' in val:
                if 'min' in val:
                    parquet_filters.append((col, '>=', float(val['min'])))
                if 'max' in val:
                    parquet_filters.append((col, '<=', float(val['max'])))
            elif 'selected' in val:
                sel = val['selected']
                if isinstance(sel, list) and len(sel) > 0:
                    parquet_filters.append((col, 'in', sel))
        elif isinstance(val, list):
            parquet_filters.append((col, 'in', val))
        else:
            parquet_filters.append((col, '==', val))
    return parquet_filters


def cmd_batch_chart_data(args: argparse.Namespace) -> Dict:
    path = args.path
    sheet = args.sheet
    charts = json.loads(base64.b64decode(args.charts).decode('utf-8')) if args.charts else []
    filters = json.loads(base64.b64decode(args.filters).decode('utf-8')) if args.filters else {}

    try:
        if HAS_PARQUET and path.endswith('.parquet'):
            needed_cols = set()
            for chart_config in charts:
                x_col = chart_config.get("x", "")
                y_col = chart_config.get("y", "")
                if x_col:
                    needed_cols.add(x_col)
                if y_col and str(y_col).strip() not in ("", "null"):
                    needed_cols.add(y_col)
            needed_cols.update(filters.keys())
            parquet_filters = _build_parquet_filters(filters)
            if parquet_filters:
                df = pd.read_parquet(path, columns=list(needed_cols) if needed_cols else None, filters=parquet_filters)
            else:
                df = pd.read_parquet(path, columns=list(needed_cols) if needed_cols else None)
        else:
            df = load_dataframe(path, sheet=sheet, cache_dir=args.cache_dir)
            df = apply_filters(df, filters)
    except Exception as e:
        return {"status": "error", "detail": str(e)}

    results = {}
    for chart_config in charts:
        chart_id = chart_config.get("id")
        x_col = chart_config.get("x", "")
        y_col = chart_config.get("y", "")

        if df.empty:
            results[chart_id] = {"x_data": [], "y_data": [], "series_name": str(x_col)}
            continue

        if not y_col or str(y_col).strip() == "" or str(y_col) == "null":
            counts = df[x_col].value_counts().head(15)
            results[chart_id] = {
                "x_data": counts.index.astype(str).tolist(),
                "y_data": counts.values.tolist(),
                "series_name": str(x_col),
            }
        else:
            if y_col not in df.columns:
                results[chart_id] = {"status": "error", "detail": f"Column '{y_col}' not found."}
                continue
            grouped = df.groupby(x_col)[y_col].mean().head(15)
            results[chart_id] = {
                "x_data": grouped.index.astype(str).tolist(),
                "y_data": [None if isinstance(v, float) and not math.isfinite(v) else round(float(v), 2) for v in grouped.values],
                "series_name": f"Average of {y_col}",
            }

    return {"status": "success", "charts": results}


def cmd_chart_data(args: argparse.Namespace) -> Dict:
    path = args.path
    sheet = args.sheet
    x_col = args.x
    y_col = args.y
    filters = json.loads(base64.b64decode(args.filters).decode('utf-8')) if args.filters else {}

    try:
        if HAS_PARQUET and path.endswith('.parquet'):
            needed_cols = {x_col}
            if y_col and str(y_col).strip() not in ("", "null"):
                needed_cols.add(y_col)
            needed_cols.update(filters.keys())
            parquet_filters = _build_parquet_filters(filters)
            if parquet_filters:
                df = pd.read_parquet(path, columns=list(needed_cols), filters=parquet_filters)
            else:
                df = pd.read_parquet(path, columns=list(needed_cols))
        else:
            df = load_dataframe(path, sheet=sheet, cache_dir=args.cache_dir)
            df = apply_filters(df, filters)
    except Exception as e:
        return {"status": "error", "detail": str(e)}

    if df.empty:
        return {"x_data": [], "y_data": [], "series_name": str(x_col)}

    if not y_col or str(y_col).strip() == "" or str(y_col) == "null":
        counts = df[x_col].value_counts().head(15)
        return {
            "x_data": counts.index.astype(str).tolist(),
            "y_data": counts.values.tolist(),
            "series_name": str(x_col),
        }
    else:
        if y_col not in df.columns:
            return {"status": "error", "detail": f"Column '{y_col}' not found."}
        grouped = df.groupby(x_col)[y_col].mean().head(15)
        return {
            "x_data": grouped.index.astype(str).tolist(),
            "y_data": [None if isinstance(v, float) and not math.isfinite(v) else round(float(v), 2) for v in grouped.values],
            "series_name": f"Average of {y_col}",
        }


def cmd_sheet_columns(args: argparse.Namespace) -> Dict:
    path = args.path
    sheet = args.sheet
    try:
        if HAS_PYARROW and path.endswith('.parquet'):
            import pyarrow.parquet as pq
            schema = pq.read_schema(path)
            pf = pq.ParquetFile(path)
            nrows = pf.metadata.num_rows
            if nrows > 0:
                row_group = pf.read_row_groups([0]).to_pandas()
            else:
                row_group = pd.DataFrame()
            columns = []
            for col_name in schema.names:
                if col_name in row_group.columns:
                    col_type = diagnose_column_type(row_group[col_name])
                else:
                    col_type = "categorical"
                columns.append({"name": str(col_name), "type": col_type})
            return {"status": "success", "columns": columns}
        df = load_dataframe(path, sheet=sheet, cache_dir=args.cache_dir)
        if len(df) > 0:
            df_head = df.head(1)
        else:
            df_head = df
        columns = []
        for col in df_head.columns:
            col_type = diagnose_column_type(df_head[col])
            columns.append({"name": str(col), "type": col_type})
        return {"status": "success", "columns": columns}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


def cmd_save_as_csv(args: argparse.Namespace) -> Dict:
    path = args.path
    sheet = args.sheet
    output = args.output

    try:
        df = load_dataframe(path, sheet=sheet, cache_dir=args.cache_dir)
        df.to_csv(output, index=False, encoding='utf-8-sig')
        return {
            "status": "success",
            "csv_path": output,
            "total_rows": len(df),
            "total_columns": len(df.columns),
            "columns": build_columns_summary(df),
            "preview": build_preview(df),
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)}


def cmd_save_as_parquet(args: argparse.Namespace) -> Dict:
    path = args.path
    sheet = args.sheet
    output = args.output

    try:
        df = load_dataframe(path, sheet=sheet, cache_dir=args.cache_dir)
        df = drop_empty_columns(df)
        _safe_to_parquet(df, output)
        return {
            "status": "success",
            "parquet_path": output,
            "total_rows": len(df),
            "total_columns": len(df.columns),
            "columns": build_columns_summary(df),
            "preview": build_preview(df),
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)}


def _merge_and_save(path: str, sheet1: str, sheet2: str, on_col: str, how: str, output: str, cache_dir: str = None) -> Dict:
    try:
        df1 = load_dataframe(path, sheet=sheet1, cache_dir=cache_dir)
        df2 = load_dataframe(path, sheet=sheet2, cache_dir=cache_dir)

        if on_col not in df1.columns:
            return {"status": "error", "detail": f"Column '{on_col}' not in sheet '{sheet1}'. Columns: {list(df1.columns)}"}
        if on_col not in df2.columns:
            return {"status": "error", "detail": f"Column '{on_col}' not in sheet '{sheet2}'. Columns: {list(df2.columns)}"}

        merged = pd.merge(df1, df2, on=on_col, how=how)
        if output.endswith('.parquet'):
            _safe_to_parquet(merged, output)
        else:
            merged.to_csv(output, index=False, encoding='utf-8-sig')
        return {
            "status": "success",
            "output_path": output,
            "total_rows": len(merged),
            "total_columns": len(merged.columns),
            "columns": build_columns_summary(merged),
            "preview": build_preview(merged),
            "merged_rows": len(merged),
            "rows_before_merge": {"sheet1": len(df1), "sheet2": len(df2)},
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)}


def cmd_merge_and_save_csv(args: argparse.Namespace) -> Dict:
    return _merge_and_save(args.path, args.sheet1, args.sheet2, args.on, args.how, args.output, args.cache_dir)


def cmd_merge_and_save_parquet(args: argparse.Namespace) -> Dict:
    return _merge_and_save(args.path, args.sheet1, args.sheet2, args.on, args.how, args.output, args.cache_dir)


def cmd_merge_multiple_sheets(args: argparse.Namespace) -> Dict:
    path = args.path
    sheets = [s.strip() for s in args.sheets.split(',') if s.strip()]
    on_col = args.on
    how = args.how

    if len(sheets) < 2:
        return {"status": "error", "detail": "At least 2 sheets are required for merge"}

    try:
        dfs = []
        for sheet in sheets:
            df = load_dataframe(path, sheet=sheet, cache_dir=args.cache_dir)
            if on_col not in df.columns:
                return {"status": "error", "detail": f"Column '{on_col}' not in sheet '{sheet}'. Columns: {list(df.columns)}"}
            dfs.append(df)

        merged = dfs[0]
        rows_before = {sheets[0]: len(dfs[0])}
        for i in range(1, len(dfs)):
            merged = pd.merge(merged, dfs[i], on=on_col, how=how)
            rows_before[sheets[i]] = len(dfs[i])

        return {
            "status": "success",
            "total_rows": len(merged),
            "total_columns": len(merged.columns),
            "columns": build_columns_summary(merged),
            "preview": build_preview(merged),
            "merged_rows": len(merged),
            "rows_before_merge": rows_before,
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)}


def _merge_multiple_and_save(path: str, sheets: List[str], on_col: str, how: str, output: str, cache_dir: str = None) -> Dict:
    if len(sheets) < 2:
        return {"status": "error", "detail": "At least 2 sheets are required for merge"}

    try:
        dfs = []
        for sheet in sheets:
            df = load_dataframe(path, sheet=sheet, cache_dir=cache_dir)
            if on_col not in df.columns:
                return {"status": "error", "detail": f"Column '{on_col}' not in sheet '{sheet}'. Columns: {list(df.columns)}"}
            dfs.append(df)

        merged = dfs[0]
        rows_before = {sheets[0]: len(dfs[0])}
        for i in range(1, len(dfs)):
            merged = pd.merge(merged, dfs[i], on=on_col, how=how)
            rows_before[sheets[i]] = len(dfs[i])

        if output.endswith('.parquet'):
            _safe_to_parquet(merged, output)
        else:
            merged.to_csv(output, index=False, encoding='utf-8-sig')
        return {
            "status": "success",
            "output_path": output,
            "total_rows": len(merged),
            "total_columns": len(merged.columns),
            "columns": build_columns_summary(merged),
            "preview": build_preview(merged),
            "merged_rows": len(merged),
            "rows_before_merge": rows_before,
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)}


def cmd_merge_multiple_and_save_csv(args: argparse.Namespace) -> Dict:
    sheets = [s.strip() for s in args.sheets.split(',') if s.strip()]
    return _merge_multiple_and_save(args.path, sheets, args.on, args.how, args.output, args.cache_dir)


def cmd_merge_multiple_and_save_parquet(args: argparse.Namespace) -> Dict:
    sheets = [s.strip() for s in args.sheets.split(',') if s.strip()]
    return _merge_multiple_and_save(args.path, sheets, args.on, args.how, args.output, args.cache_dir)


def cmd_concat_sheets(args: argparse.Namespace) -> Dict:
    path = args.path
    sheet1 = args.sheet1
    sheet2 = args.sheet2
    on_col = args.on
    how = args.how

    try:
        df1 = load_dataframe(path, sheet=sheet1, cache_dir=args.cache_dir)
        df2 = load_dataframe(path, sheet=sheet2, cache_dir=args.cache_dir)

        if on_col not in df1.columns:
            return {"status": "error", "detail": f"Column '{on_col}' not in sheet '{sheet1}'. Columns: {list(df1.columns)}"}
        if on_col not in df2.columns:
            return {"status": "error", "detail": f"Column '{on_col}' not in sheet '{sheet2}'. Columns: {list(df2.columns)}"}

        merged = pd.merge(df1, df2, on=on_col, how=how)
        result = {
            "status": "success",
            "total_rows": len(merged),
            "total_columns": len(merged.columns),
            "columns": build_columns_summary(merged),
            "preview": build_preview(merged),
            "merged_rows": len(merged),
            "rows_before_merge": {"sheet1": len(df1), "sheet2": len(df2)},
        }
        return result
    except Exception as e:
        return {"status": "error", "detail": str(e)}


def cmd_column_categories(args: argparse.Namespace) -> Dict:
    path = args.path
    sheet = args.sheet
    column = args.column
    try:
        if HAS_PARQUET and path.endswith('.parquet'):
            df = pd.read_parquet(path, columns=[column])
        else:
            df = load_dataframe(path, sheet=sheet, cache_dir=args.cache_dir)
        if column not in df.columns:
            return {"status": "error", "detail": f"Column '{column}' not found."}
        categories = df[column].dropna().unique().tolist()
        return {"categories": [str(cat) for cat in categories][:20]}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


def cmd_column_details(args: argparse.Namespace) -> Dict:
    path = args.path
    sheet = args.sheet
    column = args.column
    try:
        if HAS_PARQUET and path.endswith('.parquet'):
            df = pd.read_parquet(path, columns=[column])
        else:
            df = load_dataframe(path, sheet=sheet, cache_dir=args.cache_dir)
        if column not in df.columns:
            return {"status": "error", "detail": f"Column '{column}' not found."}
        col_type = diagnose_column_type(df[column])
        if col_type == "numeric":
            numeric_vals = pd.to_numeric(df[column], errors='coerce')
            return {
                "status": "success",
                "type": "numeric",
                "min": float(numeric_vals.min()) if pd.notna(numeric_vals.min()) else 0,
                "max": float(numeric_vals.max()) if pd.notna(numeric_vals.max()) else 0,
            }
        elif col_type == "unique_id":
            return {"status": "success", "type": "unique_id"}
        else:
            values = df[column].dropna().unique().tolist()
            return {
                "status": "success",
                "type": "categorical",
                "values": [str(v) for v in values][:100],
            }
    except Exception as e:
        return {"status": "error", "detail": str(e)}


def cmd_import_to_db(args: argparse.Namespace) -> Dict:
    try:
        import pymysql
    except ImportError:
        return {"status": "error", "detail": "pymysql not installed. Run: pip install pymysql"}

    path = args.path
    sheet = args.sheet
    file_id = int(args.file_id)

    try:
        df = load_dataframe(path, sheet=sheet, cache_dir=args.cache_dir)
    except Exception as e:
        return {"status": "error", "detail": str(e)}

    conn = pymysql.connect(
        host=args.db_host,
        user=args.db_user,
        password=args.db_password,
        database=args.db_database,
        charset='utf8mb4',
    )
    try:
        with conn.cursor() as cursor:
            cursor.execute("DELETE FROM file_data_rows WHERE file_id = %s", (file_id,))
            rows = []
            for idx, (_, row) in enumerate(df.iterrows()):
                data = json.dumps(
                    {k: v for k, v in row.items() if pd.notna(v) and not (isinstance(v, float) and not math.isfinite(v))},
                    ensure_ascii=False,
                    default=str
                )
                rows.append((file_id, idx, data))
            CHUNK_SIZE = 500
            for i in range(0, len(rows), CHUNK_SIZE):
                chunk = rows[i:i + CHUNK_SIZE]
                cursor.executemany(
                    "INSERT INTO file_data_rows (file_id, row_index, data) VALUES (%s, %s, %s)",
                    chunk,
                )
        conn.commit()
        return {"status": "success", "rows_imported": len(df)}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "detail": str(e)}
    finally:
        conn.close()


def cmd_clean_csv(args: argparse.Namespace) -> Dict:
    path = args.path
    try:
        df = load_dataframe(path, cache_dir=args.cache_dir)
        df.to_csv(path, index=False, encoding='utf-8-sig')
        return {
            "status": "success",
            "total_rows": len(df),
            "total_columns": len(df.columns),
            "columns": build_columns_summary(df),
            "preview": build_preview(df),
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)}


def main():
    parser = argparse.ArgumentParser(description="BI Data File Reader CLI")
    parser.add_argument("--daemon", action="store_true", help="Run in daemon mode, reading JSON-RPC requests from stdin")
    subparsers = parser.add_subparsers(dest="command")

    p_inspect = subparsers.add_parser("inspect", help="Inspect file structure")
    p_inspect.add_argument("--path", required=True)
    p_inspect.add_argument("--cache-dir", default="")

    p_sheet = subparsers.add_parser("sheet-data", help="Read a specific sheet")
    p_sheet.add_argument("--path", required=True)
    p_sheet.add_argument("--sheet", required=True)
    p_sheet.add_argument("--cache-dir", default="")

    p_table = subparsers.add_parser("table-data", help="Query filtered table data")
    p_table.add_argument("--path", required=True)
    p_table.add_argument("--sheet", required=True)
    p_table.add_argument("--filters", default="{}")
    p_table.add_argument("--columns", default="")
    p_table.add_argument("--cache-dir", default="")

    p_chart = subparsers.add_parser("chart-data", help="Get aggregated chart data")
    p_chart.add_argument("--path", required=True)
    p_chart.add_argument("--sheet", required=True)
    p_chart.add_argument("--x", required=True)
    p_chart.add_argument("--y", default="")
    p_chart.add_argument("--filters", default="{}")
    p_chart.add_argument("--cache-dir", default="")

    p_batch = subparsers.add_parser("batch-chart-data", help="Get aggregated chart data for multiple charts in one pass")
    p_batch.add_argument("--path", required=True)
    p_batch.add_argument("--sheet", required=True)
    p_batch.add_argument("--charts", required=True)
    p_batch.add_argument("--filters", default="{}")
    p_batch.add_argument("--cache-dir", default="")

    p_cols = subparsers.add_parser("sheet-columns", help="List columns of a sheet")
    p_cols.add_argument("--path", required=True)
    p_cols.add_argument("--sheet", required=True)
    p_cols.add_argument("--cache-dir", default="")

    p_concat = subparsers.add_parser("concat-sheets", help="Merge two sheets")
    p_concat.add_argument("--path", required=True)
    p_concat.add_argument("--sheet1", required=True)
    p_concat.add_argument("--sheet2", required=True)
    p_concat.add_argument("--on", required=True)
    p_concat.add_argument("--how", default="inner", choices=["inner", "left", "right", "outer"])
    p_concat.add_argument("--cache-dir", default="")

    p_merge_multi = subparsers.add_parser("merge-multiple-sheets", help="Merge multiple sheets on a common column")
    p_merge_multi.add_argument("--path", required=True)
    p_merge_multi.add_argument("--sheets", required=True)
    p_merge_multi.add_argument("--on", required=True)
    p_merge_multi.add_argument("--how", default="inner", choices=["inner", "left", "right", "outer"])
    p_merge_multi.add_argument("--cache-dir", default="")

    p_merge_multi_save = subparsers.add_parser("merge-multiple-and-save-csv", help="Merge multiple sheets and save as CSV")
    p_merge_multi_save.add_argument("--path", required=True)
    p_merge_multi_save.add_argument("--sheets", required=True)
    p_merge_multi_save.add_argument("--on", required=True)
    p_merge_multi_save.add_argument("--how", default="inner", choices=["inner", "left", "right", "outer"])
    p_merge_multi_save.add_argument("--output", required=True)
    p_merge_multi_save.add_argument("--cache-dir", default="")

    p_cat = subparsers.add_parser("column-categories", help="Get unique values for a column")
    p_cat.add_argument("--path", required=True)
    p_cat.add_argument("--sheet", required=True)
    p_cat.add_argument("--column", required=True)
    p_cat.add_argument("--cache-dir", default="")

    p_details = subparsers.add_parser("column-details", help="Get column type details (min/max or unique values)")
    p_details.add_argument("--path", required=True)
    p_details.add_argument("--sheet", required=True)
    p_details.add_argument("--column", required=True)
    p_details.add_argument("--cache-dir", default="")

    p_save_csv = subparsers.add_parser("save-as-csv", help="Convert a single sheet to CSV")
    p_save_csv.add_argument("--path", required=True)
    p_save_csv.add_argument("--sheet", required=True)
    p_save_csv.add_argument("--output", required=True)
    p_save_csv.add_argument("--cache-dir", default="")

    p_merge_csv = subparsers.add_parser("merge-and-save-csv", help="Merge two sheets and save as CSV")
    p_merge_csv.add_argument("--path", required=True)
    p_merge_csv.add_argument("--sheet1", required=True)
    p_merge_csv.add_argument("--sheet2", required=True)
    p_merge_csv.add_argument("--on", required=True)
    p_merge_csv.add_argument("--how", default="inner", choices=["inner", "left", "right", "outer"])
    p_merge_csv.add_argument("--output", required=True)
    p_merge_csv.add_argument("--cache-dir", default="")

    p_save_parquet = subparsers.add_parser("save-as-parquet", help="Convert a single sheet to parquet")
    p_save_parquet.add_argument("--path", required=True)
    p_save_parquet.add_argument("--sheet", required=True)
    p_save_parquet.add_argument("--output", required=True)
    p_save_parquet.add_argument("--cache-dir", default="")

    p_merge_parquet = subparsers.add_parser("merge-and-save-parquet", help="Merge two sheets and save as parquet")
    p_merge_parquet.add_argument("--path", required=True)
    p_merge_parquet.add_argument("--sheet1", required=True)
    p_merge_parquet.add_argument("--sheet2", required=True)
    p_merge_parquet.add_argument("--on", required=True)
    p_merge_parquet.add_argument("--how", default="inner", choices=["inner", "left", "right", "outer"])
    p_merge_parquet.add_argument("--output", required=True)
    p_merge_parquet.add_argument("--cache-dir", default="")

    p_merge_multi_parquet = subparsers.add_parser("merge-multiple-and-save-parquet", help="Merge multiple sheets and save as parquet")
    p_merge_multi_parquet.add_argument("--path", required=True)
    p_merge_multi_parquet.add_argument("--sheets", required=True)
    p_merge_multi_parquet.add_argument("--on", required=True)
    p_merge_multi_parquet.add_argument("--how", default="inner", choices=["inner", "left", "right", "outer"])
    p_merge_multi_parquet.add_argument("--output", required=True)
    p_merge_multi_parquet.add_argument("--cache-dir", default="")

    p_import = subparsers.add_parser("import-to-db", help="Import file data rows into MySQL")
    p_import.add_argument("--path", required=True)
    p_import.add_argument("--sheet", required=True)
    p_import.add_argument("--file-id", required=True)
    p_import.add_argument("--db-host", required=True)
    p_import.add_argument("--db-user", required=True)
    p_import.add_argument("--db-password", default="")
    p_import.add_argument("--db-database", required=True)
    p_import.add_argument("--cache-dir", default="")

    p_clean = subparsers.add_parser("clean-csv", help="Read CSV, drop empty columns, overwrite file")
    p_clean.add_argument("--path", required=True)
    p_clean.add_argument("--cache-dir", default="")

    args = parser.parse_args()

    dispatcher = {
        "inspect": cmd_inspect,
        "sheet-data": cmd_sheet_data,
        "table-data": cmd_table_data,
        "chart-data": cmd_chart_data,
        "batch-chart-data": cmd_batch_chart_data,
        "sheet-columns": cmd_sheet_columns,
        "concat-sheets": cmd_concat_sheets,
        "merge-multiple-sheets": cmd_merge_multiple_sheets,
        "merge-multiple-and-save-csv": cmd_merge_multiple_and_save_csv,
        "merge-multiple-and-save-parquet": cmd_merge_multiple_and_save_parquet,
        "save-as-csv": cmd_save_as_csv,
        "save-as-parquet": cmd_save_as_parquet,
        "merge-and-save-csv": cmd_merge_and_save_csv,
        "merge-and-save-parquet": cmd_merge_and_save_parquet,
        "column-categories": cmd_column_categories,
        "column-details": cmd_column_details,
        "clean-csv": cmd_clean_csv,
        "import-to-db": cmd_import_to_db,
    }

    if args.daemon:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except json.JSONDecodeError as e:
                resp = json.dumps({"status": "error", "detail": f"Invalid JSON: {e}"}, ensure_ascii=False)
                sys.stdout.write(resp + "\n")
                sys.stdout.flush()
                continue

            cmd = request.get("command")
            if cmd == "shutdown":
                break
            if cmd not in dispatcher:
                resp = json.dumps({"status": "error", "detail": f"Unknown command: {cmd}"}, ensure_ascii=False)
                sys.stdout.write(resp + "\n")
                sys.stdout.flush()
                continue

            cmd_args = request.get("args", {})
            # CLI mode (argparse) exposes options with underscores (e.g. --cache-dir -> cache_dir).
            # In daemon mode the args arrive as JSON keyed by the original hyphenated names,
            # so normalise them to match what the cmd_* handlers expect.
            cmd_args = {str(k).replace('-', '_'): v for k, v in cmd_args.items()}
            ns = argparse.Namespace(**cmd_args)
            try:
                result = dispatcher[cmd](ns)
                resp = json.dumps(result, ensure_ascii=False, default=str)
            except Exception as e:
                resp = json.dumps({"status": "error", "detail": str(e)}, ensure_ascii=False)
            sys.stdout.write(resp + "\n")
            sys.stdout.flush()
        sys.exit(0)

    if not args.command:
        parser.print_help()
        sys.exit(1)

    result = dispatcher[args.command](args)
    try:
        print(json.dumps(result, ensure_ascii=False, default=str))
    except UnicodeEncodeError:
        sys.stdout.buffer.write((json.dumps(result, ensure_ascii=False, default=str) + "\n").encode('utf-8'))

    if result.get("status") == "error":
        sys.exit(1)


if __name__ == "__main__":
    main()
