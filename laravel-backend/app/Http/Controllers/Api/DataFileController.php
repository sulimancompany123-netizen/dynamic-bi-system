<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataFile;
use App\Models\GlobalChartTree;
use App\Models\Project;
use App\Services\FileReaderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class DataFileController extends Controller
{
    protected FileReaderService $reader;

    public function __construct(FileReaderService $reader)
    {
        $this->reader = $reader;
    }

    /**
     * Ensure the current user may read/use the given file. Admins may access any
     * file; everyone else may only access files they uploaded or files that belong
     * to a project they own. Aborts with 403 otherwise.
     */
    protected function authorizeFileAccess(Request $request, DataFile $file): void
    {
        $user = $request->user();

        if ($user->role === 'admin' || $file->uploaded_by === $user->id) {
            return;
        }

        if ($file->project_id !== null) {
            $project = $file->project()->first();
            if ($project && $project->created_by === $user->id) {
                return;
            }
        }

        abort(403, 'غير مصرح بالوصول إلى هذا الملف');
    }

    public function index(Request $request): JsonResponse
    {
        $query = DataFile::with('uploader:id,full_name')
            ->where('upload_context', 'general');

        // Files are private: a user only sees files they uploaded or that belong to
        // a project they own. Admins see every file.
        $user = $request->user();
        if ($user->role !== 'admin') {
            $query->where(function ($q) use ($user) {
                $q->where('uploaded_by', $user->id)
                    ->orWhereHas('project', fn ($p) => $p->where('created_by', $user->id));
            });
        }

        if ($request->has('project_id')) {
            $query->where('project_id', $request->project_id);
        }

        $files = $query->get()->map(fn($f) => [
            'id' => $f->id,
            'name' => $f->name,
            'file_path' => $f->file_path,
            'uploaded_by' => $f->uploader?->full_name,
            'project_id' => $f->project_id,
            'created_at' => $f->created_at,
        ]);

        return response()->json(['status' => 'success', 'data' => $files]);
    }

    public function upload(Request $request): JsonResponse
    {
        set_time_limit(0);
        $request->validate([
            'file' => 'required|file|mimes:csv,xlsx,xls|max:102400',
            'name' => 'nullable|string|max:255',
            'upload_context' => 'sometimes|in:general,dashboard',
            'project_id' => 'sometimes|integer|exists:projects,id',
        ]);

        // A user may only attach an upload to a project they own (admins to any).
        if ($request->filled('project_id')) {
            $project = Project::find($request->input('project_id'));
            if (! $project || ! $project->isAccessibleBy($request->user())) {
                return response()->json(['status' => 'error', 'message' => 'غير مصرح بالرفع إلى هذا المشروع'], 403);
            }
        }

        $file = $request->file('file');
        $originalName = $file->getClientOriginalName();
        $storedPath = $file->store('datasets');

        $absolutePath = Storage::path($storedPath);

        $result = $this->reader->inspect($absolutePath);

        if (($result['status'] ?? '') === 'error') {
            Storage::delete($storedPath);
            return response()->json(['status' => 'error', 'detail' => $result['detail'] ?? 'Failed to read file'], 500);
        }

        $filePath = $absolutePath;
        $columnsJson = null;
        $previewJson = null;
        $totalRows = null;
        $totalColumns = null;

        if (str_ends_with($absolutePath, '.csv') && !isset($result['multi_sheet'])) {
            $parquetPath = $this->reader->deriveParquetPath($absolutePath);
            $convertResult = $this->reader->convertToParquet($absolutePath, '', $parquetPath);
            if (($convertResult['status'] ?? '') === 'success') {
                $result = $convertResult;
                $filePath = $parquetPath;
                $columnsJson = $convertResult['columns'] ?? null;
                $previewJson = $convertResult['preview'] ?? null;
                $totalRows = $convertResult['total_rows'] ?? null;
                $totalColumns = $convertResult['total_columns'] ?? null;
            }
        }

        if (!str_ends_with($absolutePath, '.csv') && !isset($result['multi_sheet'])) {
            $sheet = $result['sheets'][0];
            $parquetPath = $this->reader->deriveParquetPath($absolutePath);
            try {
                $convertResult = $this->reader->convertToParquet($absolutePath, $sheet, $parquetPath);
                if (($convertResult['status'] ?? '') === 'error') {
                    Storage::delete($storedPath);
                    @unlink($parquetPath);
                    return response()->json(['status' => 'error', 'detail' => 'Excel-to-parquet conversion failed: ' . ($convertResult['detail'] ?? 'unknown')], 500);
                }
                if (!file_exists($parquetPath)) {
                    Storage::delete($storedPath);
                    @unlink($parquetPath);
                    return response()->json(['status' => 'error', 'detail' => 'Excel-to-parquet conversion succeeded but parquet file not found'], 500);
                }
                $filePath = $parquetPath;
                $columnsJson = $convertResult['columns'] ?? null;
                $previewJson = $convertResult['preview'] ?? null;
                $totalRows = $convertResult['total_rows'] ?? null;
                $totalColumns = $convertResult['total_columns'] ?? null;
                $result = $convertResult;
            } catch (\RuntimeException $e) {
                Storage::delete($storedPath);
                @unlink($parquetPath);
                return response()->json(['status' => 'error', 'detail' => 'Excel-to-parquet conversion failed: ' . $e->getMessage()], 500);
            }
        }

        $dataFile = DataFile::create([
            'name' => $request->input('name', $originalName),
            'file_path' => $filePath,
            'uploaded_by' => $request->user()->id,
            'project_id' => $request->input('project_id'),
            'upload_context' => $request->input('upload_context', 'general'),
            'columns_json' => $columnsJson,
            'preview_json' => $previewJson,
            'total_rows' => $totalRows,
            'total_columns' => $totalColumns,
        ]);

        $response = array_merge($result, ['file_id' => $dataFile->id]);
        return response()->json($response, 201);
    }

    /**
     * Replace the data behind an existing file while keeping the same DataFile id.
     * Every tab (chart tree) and every report chart references the file by id, so by
     * mutating the record in place the whole chart structure stays intact and simply
     * points at the new data. Returns the multi_sheet payload (with the existing
     * file_id) when the new upload is a multi-sheet workbook so the client can finish
     * via the regular select-sheet / merge endpoints.
     */
    public function replace(Request $request, int $id): JsonResponse
    {
        set_time_limit(0);
        $request->validate([
            'file' => 'required|file|mimes:csv,xlsx,xls|max:102400',
        ]);

        $dataFile = DataFile::findOrFail($id);
        $this->authorizeFileAccess($request, $dataFile);

        $oldStoredFiles = $this->collectFilePaths($dataFile->file_path);

        $file = $request->file('file');
        $originalName = $file->getClientOriginalName();
        $storedPath = $file->store('datasets');
        $absolutePath = Storage::path($storedPath);

        $result = $this->reader->inspect($absolutePath);

        if (($result['status'] ?? '') === 'error') {
            Storage::delete($storedPath);
            return response()->json(['status' => 'error', 'detail' => $result['detail'] ?? 'Failed to read file'], 500);
        }

        $filePath = $absolutePath;
        $columnsJson = null;
        $previewJson = null;
        $totalRows = null;
        $totalColumns = null;

        if (str_ends_with($absolutePath, '.csv') && !isset($result['multi_sheet'])) {
            $parquetPath = $this->reader->deriveParquetPath($absolutePath);
            $convertResult = $this->reader->convertToParquet($absolutePath, '', $parquetPath);
            if (($convertResult['status'] ?? '') === 'success') {
                $result = $convertResult;
                $filePath = $parquetPath;
                $columnsJson = $convertResult['columns'] ?? null;
                $previewJson = $convertResult['preview'] ?? null;
                $totalRows = $convertResult['total_rows'] ?? null;
                $totalColumns = $convertResult['total_columns'] ?? null;
            }
        }

        if (!str_ends_with($absolutePath, '.csv') && !isset($result['multi_sheet'])) {
            $sheet = $result['sheets'][0];
            $parquetPath = $this->reader->deriveParquetPath($absolutePath);
            try {
                $convertResult = $this->reader->convertToParquet($absolutePath, $sheet, $parquetPath);
                if (($convertResult['status'] ?? '') === 'error') {
                    Storage::delete($storedPath);
                    @unlink($parquetPath);
                    return response()->json(['status' => 'error', 'detail' => 'Excel-to-parquet conversion failed: ' . ($convertResult['detail'] ?? 'unknown')], 500);
                }
                if (!file_exists($parquetPath)) {
                    Storage::delete($storedPath);
                    @unlink($parquetPath);
                    return response()->json(['status' => 'error', 'detail' => 'Excel-to-parquet conversion succeeded but parquet file not found'], 500);
                }
                $filePath = $parquetPath;
                $columnsJson = $convertResult['columns'] ?? null;
                $previewJson = $convertResult['preview'] ?? null;
                $totalRows = $convertResult['total_rows'] ?? null;
                $totalColumns = $convertResult['total_columns'] ?? null;
                $result = $convertResult;
            } catch (\RuntimeException $e) {
                Storage::delete($storedPath);
                @unlink($parquetPath);
                return response()->json(['status' => 'error', 'detail' => 'Excel-to-parquet conversion failed: ' . $e->getMessage()], 500);
            }
        }

        // Point the existing record at the new data. For a multi-sheet workbook we keep
        // the raw upload path and null the cached columns/preview; the client finishes
        // the swap through select-sheet / merge-multiple-sheets (which update in place).
        $dataFile->name = $originalName;
        $dataFile->file_path = $filePath;
        $dataFile->columns_json = $columnsJson;
        $dataFile->preview_json = $previewJson;
        $dataFile->total_rows = $totalRows;
        $dataFile->total_columns = $totalColumns;
        $dataFile->save();

        // Drop any imported rows and invalidate every cached chart that was built on the
        // old data so charts recompute against the replacement.
        DB::table('file_data_rows')->where('file_id', $dataFile->id)->delete();
        $this->invalidateChartCaches($dataFile->id);

        // Remove the previous stored files now that the record no longer references them.
        foreach ($oldStoredFiles as $path) {
            if ($path !== $filePath) {
                @unlink($path);
            }
        }

        $response = array_merge($result, ['file_id' => $dataFile->id]);
        return response()->json($response);
    }

    /**
     * Null the cached chart data on every tab built on the given file so it is
     * recomputed from the file's new contents on the next read.
     */
    protected function invalidateChartCaches(int $fileId): void
    {
        GlobalChartTree::where('file_id', $fileId)->update([
            'chart_data' => null,
            'chart_data_cached_at' => null,
        ]);
    }

    /**
     * The set of on-disk files that belong to a stored dataset path: the file itself
     * plus its sibling parquet/csv conversions, so a replace can clean them all up.
     */
    protected function collectFilePaths(string $filePath): array
    {
        $paths = [$filePath];
        $paths[] = $this->reader->deriveParquetPath($filePath);
        $paths[] = $this->reader->deriveCsvPath($filePath);

        return array_values(array_unique(array_filter($paths, fn ($p) => $p && file_exists($p))));
    }

    public function tableData(Request $request): JsonResponse
    {
        $request->validate([
            'file_id' => 'required|exists:data_files,id',
            'filters' => 'nullable|array',
            'columns' => 'nullable|array',
        ]);

        $dataFile = DataFile::findOrFail($request->file_id);
        $this->authorizeFileAccess($request, $dataFile);
        $filters = $request->input('filters', []);
        $columns = $request->input('columns', []);

        try {
            if (DB::table('file_data_rows')->where('file_id', $dataFile->id)->exists()) {
                $result = $this->reader->tableDataFromDb($dataFile->id, $filters);
            } else {
                $sheet = $this->reader->getSheetName($dataFile->file_path);
                $result = $this->reader->tableData($dataFile->file_path, $sheet, $filters, $columns);
            }
        } catch (\Throwable $e) {
            return response()->json(['status' => 'error', 'detail' => 'حدث خطأ أثناء جلب بيانات الجدول: ' . $e->getMessage()], 500);
        }

        if (($result['status'] ?? '') === 'error') {
            return response()->json($result, 500);
        }

        return response()->json($result);
    }

    public function chartData(Request $request): JsonResponse
    {
        $request->validate([
            'file_id' => 'required|exists:data_files,id',
            'x_column' => 'required|string',
            'y_column' => 'nullable|string',
            'filters' => 'nullable|array',
        ]);

        $dataFile = DataFile::findOrFail($request->file_id);
        $this->authorizeFileAccess($request, $dataFile);
        $filters = $request->input('filters', []);

        if (DB::table('file_data_rows')->where('file_id', $dataFile->id)->exists()) {
            $result = $this->reader->chartDataFromDb($dataFile->id, [['id' => 'single', 'x' => $request->x_column, 'y' => $request->y_column ?? '']], $filters);
            if (isset($result['charts']['single'])) {
                $result = ['status' => 'success', 'x_data' => $result['charts']['single']['x_data'], 'y_data' => $result['charts']['single']['y_data'], 'series_name' => $result['charts']['single']['series_name']];
            } else {
                $result = ['status' => 'success', 'x_data' => [], 'y_data' => [], 'series_name' => (string)$request->x_column];
            }
        } else {
            $sheet = $this->reader->getSheetName($dataFile->file_path);
            $result = $this->reader->chartData(
                $dataFile->file_path,
                $sheet,
                $request->x_column,
                $request->y_column,
                $filters
            );
        }

        if (($result['status'] ?? '') === 'error') {
            return response()->json($result, 500);
        }

        return response()->json($result);
    }

    public function batchChartData(Request $request): JsonResponse
    {
        $request->validate([
            'file_id' => 'required|exists:data_files,id',
            'charts' => 'required|array',
            'charts.*.id' => 'required',
            'charts.*.x' => 'required|string',
            'charts.*.y' => 'nullable|string',
            'filters' => 'nullable|array',
        ]);

        $dataFile = DataFile::findOrFail($request->file_id);
        $this->authorizeFileAccess($request, $dataFile);
        $filters = $request->input('filters', []);

        if (DB::table('file_data_rows')->where('file_id', $dataFile->id)->exists()) {
            $result = $this->reader->chartDataFromDb($dataFile->id, $request->charts, $filters);
        } else {
            $sheet = $this->reader->getSheetName($dataFile->file_path);
            $result = $this->reader->batchChartData(
                $dataFile->file_path,
                $sheet,
                $request->charts,
                $filters
            );
        }

        if (($result['status'] ?? '') === 'error') {
            return response()->json($result, 500);
        }

        return response()->json($result);
    }

    public function columnCategories(Request $request): JsonResponse
    {
        $request->validate([
            'file_id' => 'required|exists:data_files,id',
            'column' => 'required|string',
        ]);

        $dataFile = DataFile::findOrFail($request->file_id);
        $this->authorizeFileAccess($request, $dataFile);
        $sheet = $this->reader->getSheetName($dataFile->file_path);

        $result = $this->reader->columnCategories(
            $dataFile->file_path,
            $sheet,
            $request->column
        );

        if (($result['status'] ?? '') === 'error') {
            return response()->json($result, 500);
        }

        return response()->json($result);
    }

    public function columnDetails(Request $request): JsonResponse
    {
        $request->validate([
            'file_id' => 'required|exists:data_files,id',
            'column' => 'required|string',
        ]);

        $dataFile = DataFile::findOrFail($request->file_id);
        $this->authorizeFileAccess($request, $dataFile);
        $sheet = $this->reader->getSheetName($dataFile->file_path);

        $result = $this->reader->columnDetails(
            $dataFile->file_path,
            $sheet,
            $request->column
        );

        if (($result['status'] ?? '') === 'error') {
            return response()->json($result, 500);
        }

        return response()->json($result);
    }

    /**
     * Compute KPI card values for an arbitrary set of cards, each naming its own file,
     * column and metric. Cards are grouped by file so every file is read once. Used by
     * the dashboard editor to preview a card the moment it is configured.
     */
    public function cardMetrics(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'cards' => 'required|array',
            'cards.*.id' => 'required',
            'cards.*.file_id' => 'required|integer|exists:data_files,id',
            'cards.*.column' => 'required|string',
            'cards.*.metric' => 'required|string',
            'cards.*.value' => 'nullable',
        ]);

        $byFile = [];
        foreach ($validated['cards'] as $card) {
            $byFile[$card['file_id']][] = [
                'id' => $card['id'],
                'column' => $card['column'],
                'metric' => $card['metric'],
                'value' => $card['value'] ?? '',
            ];
        }

        $results = [];
        foreach ($byFile as $fileId => $cards) {
            $dataFile = DataFile::find($fileId);
            if (! $dataFile) {
                continue;
            }
            $this->authorizeFileAccess($request, $dataFile);

            try {
                $sheet = $this->reader->getSheetName($dataFile->file_path);
                $result = $this->reader->cardMetrics($dataFile->file_path, $sheet, $cards);
                foreach (($result['cards'] ?? []) as $cardId => $value) {
                    $results[$cardId] = $value;
                }
            } catch (\Exception $e) {
                // A file that fails to read leaves its cards without a value; the UI
                // shows a dash rather than failing the whole request.
                continue;
            }
        }

        return response()->json(['status' => 'success', 'cards' => $results]);
    }

    public function sheetColumns(Request $request): JsonResponse
    {
        $request->validate([
            'file_id' => 'required|exists:data_files,id',
            'sheet_name' => 'required|string',
        ]);

        $dataFile = DataFile::findOrFail($request->file_id);
        $this->authorizeFileAccess($request, $dataFile);

        $result = $this->reader->sheetColumns(
            $dataFile->file_path,
            $request->sheet_name
        );

        if (($result['status'] ?? '') === 'error') {
            return response()->json($result, 500);
        }

        return response()->json($result);
    }

    public function selectSheet(Request $request): JsonResponse
    {
        $request->validate([
            'file_id' => 'required|exists:data_files,id',
            'sheet_name' => 'nullable|string',
        ]);

        $dataFile = DataFile::findOrFail($request->file_id);
        $this->authorizeFileAccess($request, $dataFile);

        if (str_ends_with($dataFile->file_path, '.csv') || str_ends_with($dataFile->file_path, '.parquet')) {
            if ($dataFile->columns_json && $dataFile->total_rows !== null) {
                return response()->json([
                    'status' => 'success',
                    'file_id' => $dataFile->id,
                    'total_rows' => $dataFile->total_rows,
                    'total_columns' => $dataFile->total_columns,
                    'columns' => $dataFile->columns_json,
                    'preview' => $dataFile->preview_json ?? [],
                ]);
            }
            $sheet = $request->sheet_name ?? $this->reader->getSheetName($dataFile->file_path);
            $result = $this->reader->sheetData($dataFile->file_path, $sheet);
            if (($result['status'] ?? '') === 'error') {
                return response()->json($result, 500);
            }
            $dataFile->columns_json = $result['columns'] ?? null;
            $dataFile->preview_json = $result['preview'] ?? null;
            $dataFile->total_rows = $result['total_rows'] ?? null;
            $dataFile->total_columns = $result['total_columns'] ?? null;
            $dataFile->save();
            return response()->json(array_merge($result, ['file_id' => $dataFile->id]));
        }

        $sheet = $request->sheet_name ?? $this->reader->getSheetName($dataFile->file_path);
        $parquetPath = $this->reader->deriveParquetPath($dataFile->file_path);

        try {
            $result = $this->reader->convertToParquet($dataFile->file_path, $sheet, $parquetPath);
            if (($result['status'] ?? '') === 'error') {
                @unlink($parquetPath);
                return response()->json(['status' => 'error', 'detail' => 'Excel-to-parquet conversion failed: ' . ($result['detail'] ?? 'unknown')], 500);
            }
            if (!file_exists($parquetPath)) {
                @unlink($parquetPath);
                return response()->json(['status' => 'error', 'detail' => 'Excel-to-parquet conversion succeeded but parquet file not found'], 500);
            }
            $dataFile->file_path = $parquetPath;
            $dataFile->columns_json = $result['columns'] ?? null;
            $dataFile->preview_json = $result['preview'] ?? null;
            $dataFile->total_rows = $result['total_rows'] ?? null;
            $dataFile->total_columns = $result['total_columns'] ?? null;
            $dataFile->save();
            return response()->json(array_merge($result, ['file_id' => $dataFile->id]));
        } catch (\RuntimeException $e) {
            @unlink($parquetPath);
            return response()->json(['status' => 'error', 'detail' => 'Excel-to-parquet conversion failed: ' . $e->getMessage()], 500);
        }
    }

    public function importFileData(Request $request): JsonResponse
    {
        $request->validate([
            'file_id' => 'required|exists:data_files,id',
        ]);

        $dataFile = DataFile::findOrFail($request->file_id);
        $this->authorizeFileAccess($request, $dataFile);

        if (DB::table('file_data_rows')->where('file_id', $dataFile->id)->exists()) {
            return response()->json([
                'status' => 'success',
                'rows_imported' => DB::table('file_data_rows')->where('file_id', $dataFile->id)->count(),
                'message' => 'Data already imported',
            ]);
        }

        $sheet = $this->reader->getSheetName($dataFile->file_path);
        $result = $this->reader->importToDb($dataFile->file_path, $sheet, $dataFile->id);

        if (($result['status'] ?? '') === 'error') {
            return response()->json($result, 500);
        }

        return response()->json($result);
    }

    public function concatSheets(Request $request): JsonResponse
    {
        $request->validate([
            'file_id' => 'required|exists:data_files,id',
            'sheet1' => 'required|string',
            'sheet2' => 'required|string',
            'common_column' => 'required|string',
            'how' => 'sometimes|in:inner,left,right,outer',
        ]);

        $dataFile = DataFile::findOrFail($request->file_id);
        $this->authorizeFileAccess($request, $dataFile);
        $parquetPath = $this->reader->deriveParquetPath($dataFile->file_path);

        try {
            $result = $this->reader->mergeAndSaveParquet(
                $dataFile->file_path,
                $request->sheet1,
                $request->sheet2,
                $request->common_column,
                $request->input('how', 'inner'),
                $parquetPath
            );
            if (($result['status'] ?? '') === 'error') {
                @unlink($parquetPath);
                return response()->json(['status' => 'error', 'detail' => 'Excel sheet merge conversion failed: ' . ($result['detail'] ?? 'unknown')], 500);
            }
            if (!file_exists($parquetPath)) {
                @unlink($parquetPath);
                return response()->json(['status' => 'error', 'detail' => 'Excel sheet merge conversion succeeded but parquet file not found'], 500);
            }
            $dataFile->file_path = $parquetPath;
            $dataFile->save();
            return response()->json(array_merge($result, ['file_id' => $dataFile->id]));
        } catch (\RuntimeException $e) {
            @unlink($parquetPath);
            return response()->json(['status' => 'error', 'detail' => 'Excel sheet merge conversion failed: ' . $e->getMessage()], 500);
        }
    }

    public function mergeMultipleSheets(Request $request): JsonResponse
    {
        $request->validate([
            'file_id' => 'required|exists:data_files,id',
            'sheets' => 'required|array|min:2',
            'sheets.*' => 'required|string',
            'common_column' => 'required|string',
            'how' => 'sometimes|in:inner,left,right,outer',
        ]);

        $dataFile = DataFile::findOrFail($request->file_id);
        $this->authorizeFileAccess($request, $dataFile);
        $sheets = $request->sheets;
        $how = $request->input('how', 'inner');
        $parquetPath = $this->reader->deriveParquetPath($dataFile->file_path);

        try {
            $result = $this->reader->mergeMultipleAndSaveParquet(
                $dataFile->file_path,
                $sheets,
                $request->common_column,
                $how,
                $parquetPath
            );
            if (($result['status'] ?? '') === 'error') {
                @unlink($parquetPath);
                return response()->json(['status' => 'error', 'detail' => 'Excel multi-sheet merge conversion failed: ' . ($result['detail'] ?? 'unknown')], 500);
            }
            if (!file_exists($parquetPath)) {
                @unlink($parquetPath);
                return response()->json(['status' => 'error', 'detail' => 'Excel multi-sheet merge conversion succeeded but parquet file not found'], 500);
            }
            $dataFile->file_path = $parquetPath;
            $dataFile->save();
            return response()->json(array_merge($result, ['file_id' => $dataFile->id]));
        } catch (\RuntimeException $e) {
            @unlink($parquetPath);
            return response()->json(['status' => 'error', 'detail' => 'Excel multi-sheet merge conversion failed: ' . $e->getMessage()], 500);
        }
    }
}