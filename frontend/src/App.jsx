import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import FileUpload from './components/FileUpload';
import FileList from './components/FileList';
import ProjectList from './components/ProjectList';
import ProjectDetail from './components/ProjectDetail';
import UserManagement from './components/UserManagement';
import Login from './components/Login';
import Breadcrumbs from './components/Breadcrumbs';
import Sidebar from './components/Sidebar';
import ChartView from './components/ChartView';
import { BarChart3, Table, EyeOff, Loader2, LogOut, Plus, Trash2, ArrowLeft, Upload, Home, PanelLeft, PanelLeftClose, FileSpreadsheet, FolderKanban, FileText, LayoutDashboard } from 'lucide-react';
import ChartEditModal from './components/ChartEditModal';
import ReportList from './components/ReportList';
import ReportEditor from './components/ReportEditor';
import TemplateList from './components/TemplateList';
import FontManager from './components/FontManager';
import DashboardList from './components/DashboardList';
import DashboardEditor from './components/DashboardEditor';
import DashboardViewer from './components/DashboardViewer';
import SharedDashboards from './components/SharedDashboards';
import { setApiToken, apiPost, apiGet, apiPut, apiDelete, LONG_TIMEOUT } from './api';
import { isLocalFont } from './lib/localFonts';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('bi_token') || null);
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('bi_user') || 'null'));
  const [isLoggedIn, setIsLoggedIn] = useState(!!token);

  const isAdmin = user?.role === 'admin';
  const [page, setPage] = useState('projects');
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [activeProject, setActiveProject] = useState(null);
  const [activeReport, setActiveReport] = useState(null);
  const [reportsProject, setReportsProject] = useState(null);
  const [dashboardsProject, setDashboardsProject] = useState(null);
  const [activeDashboard, setActiveDashboard] = useState(null);
  const [viewerDashboardId, setViewerDashboardId] = useState(null);

  const [fileUploaded, setFileUploaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [fileId, setFileId] = useState(null);
  const [customCategoryColors, setCustomCategoryColors] = useState({});
  const [allColumns, setAllColumns] = useState([]);
  const [dataPreview, setDataPreview] = useState([]);
  const [dataSummary, setDataSummary] = useState({ rows: 0, cols: 0 });
  const [isAnalysisStarted, setIsAnalysisStarted] = useState(false);
  const [editingChart, setEditingChart] = useState(null);
  const [analysisLoadingMsg, setAnalysisLoadingMsg] = useState('');

  const [showNodeTable, setShowNodeTable] = useState(false);
  const [nodeTableData, setNodeTableData] = useState([]);
  const [nodeTableRowsCount, setNodeTableRowsCount] = useState(0);
  const [loadingTable, setLoadingTable] = useState(false);
  const [tableError, setTableError] = useState(null);
  const [visibleRowCount, setVisibleRowCount] = useState(0);
  const CHUNK_SIZE = 10;

  const [fontFamily, setFontFamily] = useState('Cairo, sans-serif');
  const [chartWidth, setChartWidth] = useState('md:col-span-1');
  const [chartHeight, setChartHeight] = useState('350px');
  const [barWidth, setBarWidth] = useState(50);
  const [colorMode, setColorMode] = useState('single');

  const [breadcrumbs, setBreadcrumbs] = useState([{ id: 'root', name: 'الرئيسية', filter: {} }]);

  const [charts, setCharts] = useState([]);
  const [chartTrees, setChartTrees] = useState([]);
  const [activeTreeId, setActiveTreeId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedX, setSelectedX] = useState('');
  const [selectedY, setSelectedY] = useState('');
  const [chartType, setChartType] = useState('bar');
  const [chartTitle, setChartTitle] = useState('');
  const [themeColor, setThemeColor] = useState('#054239');
  const [fontSize, setFontSize] = useState(14);


  const [expandedFiles, setExpandedFiles] = useState({});

  const [fonts, setFonts] = useState([]);
  const [showFontManager, setShowFontManager] = useState(false);

  const [chartDataMap, setChartDataMap] = useState({});

  // Per-tree derived state
  const activeTree = chartTrees.find(t => t.id === activeTreeId);
  const treeStructure = activeTree?.structure || {};
  const treeDeletedColumns = treeStructure?.deleted_columns ?? [];
  const treeColumnFilters = useMemo(() => treeStructure?.column_filters ?? {}, [treeStructure?.column_filters]);

  const saveTimeoutRef = useRef(null);
  const tableSeqRef = useRef(0);
  const tableAbortRef = useRef(null);
  const initialChartDataLoadedRef = useRef(false);
  const lastFetchedKeyRef = useRef(null);

  useEffect(() => {
    if (token) {
      setApiToken(token);
    }
  }, [token]);

  const refreshFonts = useCallback(async () => {
    try {
      const res = await apiGet('/api/fonts');
      if (res.status === 'success') {
        setFonts(res.data);
        res.data.forEach(font => {
          if (isLocalFont(font.name)) return; // self-hosted via @font-face, not on Google
          const id = `font-link-${font.name.toLowerCase().replace(/\s+/g, '-')}`;
          if (!document.getElementById(id)) {
            const link = document.createElement('link');
            link.id = id;
            link.rel = 'stylesheet';
            link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.name)}:wght@400;700&display=swap`;
            document.head.appendChild(link);
          }
        });
      }
    } catch (err) {
      console.error('Failed to fetch fonts:', err);
    }
  }, []);

  useEffect(() => {
    if (token) refreshFonts();
  }, [token, refreshFonts]);

  const fetchNodeTableData = useCallback(async () => {
    if (!fileId) return;
    const seq = ++tableSeqRef.current;
    if (tableAbortRef.current) tableAbortRef.current.abort();
    setLoadingTable(true);
    setTableError(null);
    setVisibleRowCount(0);
    const controller = new AbortController();
    tableAbortRef.current = controller;
    try {
      const currentFilters = breadcrumbs[breadcrumbs.length - 1].filter;
      const mergedFilters = { ...treeColumnFilters, ...currentFilters };
      const resData = await apiPost('/api/table-data', { file_id: fileId, filters: Object.keys(mergedFilters).length > 0 ? mergedFilters : {} }, 30000, controller.signal);
      if (seq !== tableSeqRef.current) return;
      if (resData.status === 'success') {
        setNodeTableData(resData.data ? [...resData.data] : []);
        setNodeTableRowsCount(resData.total_filtered_rows || 0);
        if (resData.data && resData.data.length > 0) {
          setVisibleRowCount(Math.min(CHUNK_SIZE, resData.data.length));
        }
        setLoadingTable(false);
      } else {
        setTableError(resData.detail || 'فشل تحميل بيانات الجدول');
        setNodeTableData([]);
        setNodeTableRowsCount(0);
        setLoadingTable(false);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setLoadingTable(false);
        return;
      }
      if (seq !== tableSeqRef.current) return;
      console.error("Error fetching node table data:", err);
      setTableError('فشل الاتصال بالخادم');
      setNodeTableData([]);
      setNodeTableRowsCount(0);
      setLoadingTable(false);
    }
  }, [fileId, breadcrumbs, treeColumnFilters]);

  const debouncedSaveTreeConfig = (changes) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (activeTreeId) {
        apiPut(`/api/global-chart-trees/${activeTreeId}`, { structure: changes });
      }
    }, 500);
  };

  useEffect(() => {
    if (!fileId || !isAnalysisStarted) return;

    const currentLevelId = breadcrumbs[breadcrumbs.length - 1]?.id;
    const visibleCharts = charts.filter(c => c.levelId === currentLevelId);
    if (visibleCharts.length === 0) return;

    const currentFilters = breadcrumbs[breadcrumbs.length - 1].filter;
    const mergedFilters = { ...treeColumnFilters, ...currentFilters };

    const fetchKey = `${currentLevelId}_${JSON.stringify(mergedFilters)}`;
    if (fetchKey === lastFetchedKeyRef.current) return;
    lastFetchedKeyRef.current = fetchKey;

    const chartConfigs = visibleCharts.map(c => ({ id: c.id, x: c.x, y: c.y || "" }));
    (async () => {
      try {
        const data = await apiPost('/api/batch-chart-data', {
          file_id: fileId,
          charts: chartConfigs,
          filters: Object.keys(mergedFilters).length > 0 ? mergedFilters : {},
        });
        if (data.status === 'success' && data.charts) {
          setChartDataMap(prev => ({ ...prev, ...data.charts }));
        }
      } catch (err) {
        console.error("Error fetching chart data:", err);
      }
    })();
  }, [charts, breadcrumbs, treeColumnFilters, fileId, isAnalysisStarted]);

  useEffect(() => {
    if (isAnalysisStarted && showNodeTable) {
      fetchNodeTableData();
    }
  }, [isAnalysisStarted, showNodeTable, fetchNodeTableData]);

  useEffect(() => {
    if (!loadingTable && nodeTableData.length > 0 && visibleRowCount < nodeTableData.length) {
      const raf = requestAnimationFrame(() => {
        setVisibleRowCount(prev => Math.min(prev + CHUNK_SIZE, nodeTableData.length));
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [loadingTable, nodeTableData, visibleRowCount]);

  const handleLogin = (newToken, userData) => {
    setToken(newToken);
    setUser(userData);
    setIsLoggedIn(true);
    setApiToken(newToken);
    localStorage.setItem('bi_token', newToken);
    localStorage.setItem('bi_user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setIsLoggedIn(false);
    setApiToken(null);
    localStorage.removeItem('bi_token');
    localStorage.removeItem('bi_user');
    setFileUploaded(false);
    setFileId(null);
    setCharts([]);
    setChartDataMap({});
    setIsAnalysisStarted(false);
    setPage('files');
    setActiveProjectId(null);
    setActiveProject(null);
  };

const goHome = () => {
    setFileUploaded(false);
    setFileId(null);
    setCharts([]);
    setChartDataMap({});
    setChartTrees([]);
    setActiveTreeId(null);
    setIsAnalysisStarted(false);
    setBreadcrumbs([{ id: 'root', name: 'الرئيسية', filter: {} }]);
    setActiveProjectId(null);
    setActiveProject(null);
    setPage('projects');
  };

  const handleSelectProject = (project) => {
    setActiveProjectId(project.id);
    setActiveProject(project);
    setPage('project-detail');
  };

  const handleOpenReports = (projectData) => {
    setReportsProject(projectData);
    setActiveReport(null);
    setPage('reports');
  };

  const handleOpenReport = async (report) => {
    try {
      const { apiGet } = await import('./api')
      const res = await apiGet(`/api/reports/${report.id}`)
      if (res.status === 'success') {
        setActiveReport(res.data)
        setPage('report-editor')
      }
    } catch (err) {
      console.error('Failed to load report:', err)
    }
  };

  const handleBackFromReports = () => {
    setPage('project-detail');
    setActiveReport(null);
  };

  const handleOpenDashboards = (projectData) => {
    setDashboardsProject(projectData);
    setActiveDashboard(null);
    setPage('dashboards');
  };

  const handleOpenDashboard = (dashboard) => {
    setActiveDashboard(dashboard);
    setPage('dashboard-editor');
  };

  const handleBackFromDashboards = () => {
    setPage('project-detail');
    setActiveDashboard(null);
  };

  // Read-only view of a dashboard shared with the current user.
  const handleViewSharedDashboard = (dashboard) => {
    setViewerDashboardId(dashboard.id);
    setPage('dashboard-viewer');
  };

  const handleBackFromEditor = () => {
    setPage(activeReport?.is_template ? 'templates' : 'reports');
    setActiveReport(null);
  };

  const handleOpenProjectTab = async (tab, file) => {
    if (!file) return;
    setLoading(true);
    setFileName(file.name);
    setFileId(file.id);
    setIsAnalysisStarted(false);
    setChartTrees([]);
    setActiveTreeId(null);
    setCharts([]);
    try {
      const res = await apiPost('/api/select-sheet', { file_id: file.id }, LONG_TIMEOUT);
      if (res.status === 'success' && res.columns) {
        setDataSummary({ rows: res.total_rows || 0, cols: res.total_columns || 0 });
        setAllColumns(res.columns);
        setDataPreview(res.preview || []);
      } else {
        setDataSummary({ rows: 0, cols: 0 });
        setAllColumns([]);
        setDataPreview([]);
      }
    } catch (err) {
      console.error('Error selecting file:', err);
    }
    setIsAnalysisStarted(true);
    setPage('analysis');
    await loadTabChartTree(tab);
    setLoading(false);
  };

  const autoGenerateCharts = (columns) => {
    const cols = columns || allColumns;
    const autoCharts = cols
      .filter(col => col.type !== 'unique_id')
      .slice(0, 10)
      .map((col, index) => ({
        id: Date.now() + index,
        x: col.name,
        y: "",
        type: 'bar',
        title: `توزيع البيانات حسب: ${col.name}`,
        themeColor: '#054239',
        fontSize: 14,
        fontFamily: fontFamily,
        chartWidth: 'md:col-span-1',
        chartHeight: '350px',
        barWidth: 50,
        colorMode: 'single',
        levelId: 'root',
        filter: {}, // root-level auto charts are global (no drill-down filter)
        customCategoryColors: null
      }));
    setCharts(autoCharts);
    const autoMap = {};
    autoCharts.forEach(c => { autoMap[c.id] = null; });
    setChartDataMap(autoMap);
    return autoCharts;
  };

  // The id the app assigns to a drill-down level: a hash of the level's filter object.
  // Must stay identical to the formula in onChartClick so reconstruction below matches.
  const levelHashOf = (filterObj) =>
    `level_${Array.from(JSON.stringify(filterObj)).reduce((acc, ch) => ((acc << 5) - acc) + ch.charCodeAt(0) | 0, 0)}`;

  // One-time backfill for legacy drilled charts: older charts stored only their `levelId`
  // (a hash of their drill filter) without the filter itself, and the breadcrumb that held
  // that filter is not persisted in the tree. We recover each missing filter by brute-forcing
  // column/value combinations — the drill columns are exactly the charts' x-axes — against the
  // same hash, then persist `chart.filter` so reports reproduce the correct filtered slice.
  const backfillChartFilters = async (treeCharts, treeId, fid) => {
    if (!treeId || !fid || !Array.isArray(treeCharts)) return;
    const needing = treeCharts.filter(c =>
      c.levelId && c.levelId !== 'root' && (!c.filter || Object.keys(c.filter).length === 0));
    if (needing.length === 0) return;
    const neededIds = new Set(needing.map(c => c.levelId));

    const candidateCols = [...new Set(treeCharts.map(c => c.x).filter(Boolean))];
    const colDefByName = {};
    (allColumns || []).forEach(c => { colDefByName[c.name] = c; });
    const colValues = {};
    await Promise.all(candidateCols.map(async (col) => {
      try {
        const data = await apiGet('/api/column-categories', { file_id: fid, column: col });
        colValues[col] = data.categories || [];
      } catch { colValues[col] = []; }
    }));
    // Drilling coerces numeric/integer category values to Number; replicate so hashes match.
    const coerce = (col, v) => {
      const t = colDefByName[col]?.type;
      return (t === 'numeric' || t === 'integer') && v !== null && v !== '' && !isNaN(Number(v)) ? Number(v) : v;
    };

    // BFS from root over column/value combos (bounded) to recover each needed level's filter.
    const found = {};
    const seen = new Set([levelHashOf({})]);
    const queue = [{ filter: {}, depth: 0 }];
    const MAX_DEPTH = 3, ITER_CAP = 300000;
    let iters = 0;
    while (queue.length && Object.keys(found).length < neededIds.size && iters < ITER_CAP) {
      const { filter: base, depth } = queue.shift();
      if (depth >= MAX_DEPTH) continue;
      for (const col of candidateCols) {
        if (col in base) continue;
        for (const rawV of (colValues[col] || [])) {
          iters++;
          const candidate = { ...base, [col]: coerce(col, rawV) };
          const h = levelHashOf(candidate);
          if (seen.has(h)) continue;
          seen.add(h);
          if (neededIds.has(h)) found[h] = candidate;
          queue.push({ filter: candidate, depth: depth + 1 });
        }
      }
    }
    if (Object.keys(found).length === 0) return;

    const updated = treeCharts.map(c =>
      (found[c.levelId] && (!c.filter || !Object.keys(c.filter).length)) ? { ...c, filter: found[c.levelId] } : c);
    setCharts(prev => prev.map(c => {
      const u = updated.find(x => x.id === c.id);
      return u ? u : c;
    }));
    try {
      const tree = chartTrees.find(t => t.id === treeId);
      const newStructure = { ...(tree?.structure || {}), charts: updated };
      await apiPut(`/api/global-chart-trees/${treeId}`, { structure: newStructure });
      setChartTrees(prev => prev.map(t => t.id === treeId ? { ...t, structure: newStructure } : t));
      console.info(`[backfill] reconstructed filters for ${Object.keys(found).length} drilled chart level(s)`);
    } catch (e) {
      console.error('Failed to persist reconstructed chart filters:', e);
    }
  };

  const loadTabChartTree = async (tab, columnsOverride) => {
    lastFetchedKeyRef.current = null;
    setBreadcrumbs([{ id: 'root', name: 'الرئيسية', filter: {} }]);
    try {
      const chartRes = await apiGet(`/api/global-chart-trees/${tab.id}`);
      const treeData = chartRes.data;
      if (treeData) {
        setActiveTreeId(treeData.id);
        const storedCharts = treeData.structure?.charts;
        if (storedCharts && storedCharts.length > 0) {
          const currentColNames = (columnsOverride || allColumns).map(c => c.name);
          const allColumnsExist = storedCharts.every(c => currentColNames.includes(c.x));
          if (allColumnsExist) {
            setCharts(storedCharts);
            const m = {};
            storedCharts.forEach(c => { m[c.id] = null; });
            setChartDataMap(m);
            backfillChartFilters(storedCharts, treeData.id, treeData.file_id || fileId);
          } else {
            const autoCharts = autoGenerateCharts(columnsOverride);
            const newStructure = { ...(treeData.structure || {}), charts: autoCharts, breadcrumbs: [{ id: 'root', name: 'الرئيسية', filter: {} }] };
            try {
              await apiPut(`/api/global-chart-trees/${tab.id}`, { structure: newStructure });
            } catch (e) { console.error('Failed to save auto charts:', e); }
            setCharts(autoCharts);
          }
        } else {
          const autoCharts = autoGenerateCharts(columnsOverride);
          const newStructure = { ...(treeData.structure || {}), charts: autoCharts, breadcrumbs: [{ id: 'root', name: 'الرئيسية', filter: {} }] };
          try {
            await apiPut(`/api/global-chart-trees/${tab.id}`, { structure: newStructure });
          } catch (e) { console.error('Failed to save auto charts:', e); }
          setCharts(autoCharts);
        }
      }
    } catch (chartErr) {
      console.error('Failed to load project tab:', chartErr);
    }
  };

  const handleEnterProjectCharts = async (projectData) => {
    if (!projectData?.files || projectData.files.length === 0) {
      alert('لا توجد ملفات في هذا المشروع');
      return;
    }
    setActiveProject({ ...activeProject, ...projectData });
    const firstFile = projectData.files[0];
    setLoading(true);
    setFileName(firstFile.name);
    setFileId(firstFile.id);
    setIsAnalysisStarted(false);
setCharts([]);
    setBreadcrumbs([{ id: 'root', name: 'الرئيسية', filter: {} }]);

    setChartTrees(projectData.tabs || []);
    setExpandedFiles({});
    const expanded = {};
    (projectData.files || []).forEach(f => { expanded[f.id] = true; });
    setExpandedFiles(expanded);

    let res;
    try {
      res = await apiPost('/api/select-sheet', { file_id: firstFile.id }, LONG_TIMEOUT);
      if (res.status === 'success' && res.columns) {
        setDataSummary({ rows: res.total_rows || 0, cols: res.total_columns || 0 });
        setAllColumns(res.columns);
        setDataPreview(res.preview || []);
      } else {
        setDataSummary({ rows: 0, cols: 0 });
        setAllColumns([]);
        setDataPreview([]);
      }
    } catch (err) {
      console.error('Error selecting file:', err);
    }
    setIsAnalysisStarted(true);
    setFileUploaded(true);
    setPage('analysis');

    const firstTab = (projectData.tabs || []).find(t => t.file_id === firstFile.id) || projectData.tabs?.[0];
    if (firstTab) {
      await loadTabChartTree(firstTab, res?.columns);
    } else {
      try {
        const createRes = await apiPost('/api/global-chart-trees', {
          file_id: firstFile.id,
          project_id: activeProject?.id || projectData.id,
          tree_name: 'التبويب الرئيسي',
          structure: {
            charts: [],
            breadcrumbs: [{ id: 'root', name: 'الرئيسية', filter: {} }],
            deleted_columns: [],
            column_filters: {}
          }
        });
        if (createRes.status === 'success' && createRes.data) {
          const newTab = createRes.data;
          setChartTrees(prev => [...prev, newTab]);
          await loadTabChartTree(newTab);
        }
      } catch (err) {
        console.error('Failed to auto-create tab:', err);
        const autoCharts = autoGenerateCharts();
        setCharts(autoCharts);
      }
    }
    setLoading(false);
  };

  const switchProjectTab = async (tabId, targetFileId) => {
    const tab = chartTrees.find(t => t.id === tabId);
    if (!tab) return;
    if (targetFileId !== fileId) {
      const file = activeProject?.files?.find(f => f.id === targetFileId);
      if (!file) return;
      setLoading(true);
      setFileName(file.name);
      setFileId(targetFileId);
      setCharts([]);
      setChartDataMap({});
      let res;
      try {
        res = await apiPost('/api/select-sheet', { file_id: targetFileId }, LONG_TIMEOUT);
        if (res.status === 'success' && res.columns) {
          setDataSummary({ rows: res.total_rows || 0, cols: res.total_columns || 0 });
          setAllColumns(res.columns);
          setDataPreview(res.preview || []);
        } else {
          setDataSummary({ rows: 0, cols: 0 });
          setAllColumns([]);
          setDataPreview([]);
        }
      } catch (err) {
        console.error('Error selecting file:', err);
      }
      await loadTabChartTree(tab, res?.columns);
      setLoading(false);
    } else {
      await loadTabChartTree(tab);
    }
  };

  const handleUploadSuccess = (result) => {
    setFileName(result.filename || '');
    setFileId(result.file_id);
    setDataSummary({ rows: result.total_rows, cols: result.total_columns });
    setAllColumns(result.columns);
    setDataPreview(result.preview);
    setFileUploaded(true);
  };

  const handleSelectFile = async (file) => {
    setLoading(true);
    setFileName(file.name);
    setFileId(file.id);
    setIsAnalysisStarted(false);
    setChartTrees([]);
    setActiveTreeId(null);
    setCharts([]);
    try {
      const res = await apiPost('/api/select-sheet', { file_id: file.id }, LONG_TIMEOUT);
      if (res.status === 'success' && res.columns) {
        setDataSummary({ rows: res.total_rows || 0, cols: res.total_columns || 0 });
        setAllColumns(res.columns);
        setDataPreview(res.preview || []);
        setFileUploaded(true);
        setPage('analysis');
      } else {
        setDataSummary({ rows: 0, cols: 0 });
        setAllColumns([]);
        setDataPreview([]);
        setFileUploaded(true);
        setPage('analysis');
      }
    } catch (err) {
      console.error('Error selecting file:', err);
    } finally {
      setLoading(false);
    }
  };

  const getCompatibleCharts = () => {
    if (!selectedX) return [];
    const colX = allColumns.find(c => c.name === selectedX);
    const colY = allColumns.find(c => c.name === selectedY);
    if (!selectedY) {
      return [
        { value: 'bar', label: 'مخطط أعمدة' },
        { value: 'horizontal_bar', label: 'أعمدة أفقي' },
        { value: 'pie', label: 'دائري (Pie)' },
        { value: 'donut', label: 'حلقة (Donut)' },
        { value: 'polarBar', label: 'أعمدة قطبي' },
        { value: 'funnel', label: 'قمعي (Funnel)' },
        { value: 'treemap', label: 'Treemap' },
        { value: 'sunburst', label: 'Sunburst' },
        { value: 'line', label: 'خطي' },
        { value: 'area', label: 'مساحي' },
      ];
    }
    if (colX?.type === 'numeric' && colY?.type === 'numeric') {
      return [
        { value: 'scatter', label: 'مبعثر (Scatter)' },
        { value: 'line', label: 'خطي' },
        { value: 'bar', label: 'أعمدة' },
        { value: 'area', label: 'مساحي' },
      ];
    }
    if (colX?.type === 'categorical' && colY?.type === 'numeric') {
      return [
        { value: 'bar', label: 'أعمدة رأسي' },
        { value: 'horizontal_bar', label: 'أعمدة أفقي' },
        { value: 'pie', label: 'دائري' },
        { value: 'line', label: 'خطي' },
        { value: 'area', label: 'مساحي' },
        { value: 'scatter', label: 'مبعثر' },
        { value: 'polarBar', label: 'أعمدة قطبي' },
        { value: 'funnel', label: 'قمعي (Funnel)' },
      ];
    }
    if (colX?.type === 'date' && colY?.type === 'numeric') {
      return [
        { value: 'line', label: 'خطي زمني' },
        { value: 'area', label: 'مساحي' },
        { value: 'bar', label: 'أعمدة' },
        { value: 'scatter', label: 'مبعثر' },
      ];
    }
    return [{ value: 'bar', label: 'مخطط عام' }];
  };

  const handleStartAnalysis = async () => {
    setIsAnalysisStarted(true);

    setAnalysisLoadingMsg('جاري استيراد البيانات إلى قاعدة البيانات...');
    try {
      await apiPost('/api/import-file-data', { file_id: fileId });
    } catch (err) {
      console.error('Failed to import file data:', err);
    }

    try {
      const res = await apiGet(`/api/global-chart-trees?file_id=${fileId}`);
      if (res.status === 'success' && Array.isArray(res.data) && res.data.length > 0) {
        setChartTrees(res.data);
        const firstTree = res.data[0];
        setActiveTreeId(firstTree.id);
        if (firstTree.structure?.charts) {
          setCharts(firstTree.structure.charts);
          const m = {};
          firstTree.structure.charts.forEach(c => { m[c.id] = null; });
          setChartDataMap(m);
          backfillChartFilters(firstTree.structure.charts, firstTree.id, firstTree.file_id || fileId);
        }
setBreadcrumbs([{ id: 'root', name: 'الرئيسية', filter: {} }]);
        initialChartDataLoadedRef.current = false;
        try {
          const chartRes = await apiGet(`/api/global-chart-trees/${firstTree.id}?include_chart_data=1`);
          const chartData = chartRes.data?.chart_data;
          if (chartRes.status === 'success' && chartData && typeof chartData === 'object' && !Array.isArray(chartData)) {
            setChartDataMap(chartData);
          }
          initialChartDataLoadedRef.current = true;
        } catch (chartErr) {
          console.error('Failed to load initial chart data:', chartErr);
        }

        setAnalysisLoadingMsg('');
        return;
      }
    } catch (err) {
      console.error('Failed to load chart trees:', err);
    }

    const autoGeneratedCharts = allColumns
      .filter(col => col.type !== 'unique_id')
      .slice(0, 10)
      .map((col, index) => ({
        id: Date.now() + index,
        x: col.name,
        y: "",
        type: 'bar',
        title: `توزيع البيانات حسب: ${col.name}`,
        themeColor: '#054239',
        fontSize: 14,
        fontFamily: fontFamily,
        chartWidth: 'md:col-span-1',
        chartHeight: '350px',
        barWidth: 50,
        colorMode: 'single',
        levelId: 'root',
        filter: {}, // root-level auto charts are global (no drill-down filter)
        customCategoryColors: null
      }));
    setCharts(autoGeneratedCharts);
    const autoMap = {};
    autoGeneratedCharts.forEach(c => { autoMap[c.id] = null; });
    setChartDataMap(autoMap);
    try {
      const createRes = await apiPost('/api/global-chart-trees', {
        file_id: fileId,
        tree_name: 'الشجرة الرئيسية',
        structure: {
          charts: autoGeneratedCharts,
          breadcrumbs: [{ id: 'root', name: 'الرئيسية', filter: {} }],
          deleted_columns: [],
          column_filters: {}
        }
      });
      if (createRes.status === 'success' && createRes.data) {
        setChartTrees(prev => [...prev, createRes.data]);
        setActiveTreeId(createRes.data.id);
        try {
          const chartRes = await apiGet(`/api/global-chart-trees/${createRes.data.id}?include_chart_data=1`);
          const chartData = chartRes.data?.chart_data;
          if (chartRes.status === 'success' && chartData && typeof chartData === 'object' && !Array.isArray(chartData)) {
            setChartDataMap(chartData);
          }
          initialChartDataLoadedRef.current = true;
        } catch (chartErr) {
          console.error('Failed to load initial chart data:', chartErr);
        }
      }
    } catch (err) {
      console.error('Failed to auto-create chart tree:', err);
    }
    setAnalysisLoadingMsg('');
  };

  const saveCharts = async (chartsToSave) => {
    if (!fileId) return;
    if (activeTreeId) {
      try {
        const tree = chartTrees.find(t => t.id === activeTreeId);
        const newStructure = { ...(tree?.structure || {}), charts: chartsToSave, breadcrumbs };
        await apiPut(`/api/global-chart-trees/${activeTreeId}`, { structure: newStructure });
        setChartTrees(prev => prev.map(t =>
          t.id === activeTreeId ? { ...t, structure: newStructure } : t
        ));
      } catch (err) {
        console.error('Failed to auto-save chart tree:', err);
      }
    }
  };

  const switchChartTree = async (treeId) => {
    const tree = chartTrees.find(t => t.id === treeId);
    if (!tree) return;
    setActiveTreeId(treeId);
    if (tree.structure?.charts) {
      setCharts(tree.structure.charts);
      const m = {};
      tree.structure.charts.forEach(c => { m[c.id] = null; });
      setChartDataMap(m);
      backfillChartFilters(tree.structure.charts, treeId, tree.file_id || fileId);
      initialChartDataLoadedRef.current = false;
      try {
        const chartRes = await apiGet(`/api/global-chart-trees/${treeId}?include_chart_data=1`);
        const chartData = chartRes.data?.chart_data;
        if (chartRes.status === 'success' && chartData && typeof chartData === 'object' && !Array.isArray(chartData)) {
          setChartDataMap(chartData);
        }
        initialChartDataLoadedRef.current = true;
      } catch (chartErr) {
        console.error('Failed to load chart data for tree:', chartErr);
      }
    }
setBreadcrumbs([{ id: 'root', name: 'الرئيسية', filter: {} }]);
  };

  const handleDeleteChartTree = async (treeId) => {
    if (!confirm('هل أنت متأكد من حذف هذه الشجرة؟')) return;
    try {
      const res = await apiDelete(`/api/global-chart-trees/${treeId}`);
      if (res.status === 'success') {
        const remaining = chartTrees.filter(t => t.id !== treeId);
        setChartTrees(remaining);
        if (activeTreeId === treeId) {
          if (remaining.length > 0) {
            switchChartTree(remaining[0].id);
          } else {
            setActiveTreeId(null);
            setCharts([]);
          }
        }
      }
    } catch (err) {
      console.error('Failed to delete chart tree:', err);
    }
  };

  const handleDeleteChart = (id) => {
    const newCharts = charts.filter(c => c.id !== id);
    setCharts(newCharts);
    setChartDataMap(prev => { const m = {...prev}; delete m[id]; return m; });
    saveCharts(newCharts);
  };

  const handleAddChart = () => {
    if (!selectedX) return alert('يرجى تحديد المحور X');
    const newChart = {
      id: Date.now(),
      x: selectedX,
      y: selectedY,
      type: chartType,
      title: chartTitle,
      themeColor: themeColor,
      fontSize: fontSize,
      levelId: breadcrumbs[breadcrumbs.length - 1].id,
      // Persist the drill-down filter of the level this chart was created at, so consumers
      // (e.g. reports) can reproduce the exact filtered slice without relying on the live
      // breadcrumb path, which is not reliably saved in the tree structure.
      filter: { ...breadcrumbs[breadcrumbs.length - 1].filter },
      fontFamily: fontFamily,
      chartWidth: chartWidth,
      chartHeight: chartHeight,
      barWidth: barWidth,
      colorMode: colorMode,
      customCategoryColors: colorMode === 'manual' ? { ...customCategoryColors } : null
    };
    const newCharts = [...charts, newChart];
    setCharts(newCharts);
    clearSidebarFields();
    saveCharts(newCharts);
  };

  const handleUpdateChart = (chartId, updatedFields) => {
    const newCharts = charts.map(ch => {
      if (ch.id === chartId) {
        return {
          ...ch,
          x: updatedFields.x,
          y: updatedFields.y,
          type: updatedFields.type,
          title: updatedFields.title,
          themeColor: updatedFields.themeColor,
          fontSize: updatedFields.fontSize,
          fontFamily: updatedFields.fontFamily,
          chartWidth: updatedFields.chartWidth,
          chartHeight: updatedFields.chartHeight,
          barWidth: updatedFields.barWidth,
          colorMode: updatedFields.colorMode,
          customCategoryColors: updatedFields.colorMode === 'manual' ? { ...updatedFields.customCategoryColors } : null
        };
      }
      return ch;
    });
    setCharts(newCharts);
    setEditingChart(null);
    saveCharts(newCharts);
  };

  const handleEditClick = (chart) => {
    setEditingChart(chart);
  };

  const clearSidebarFields = () => {
    setChartTitle('');
    setCustomCategoryColors({});
  };

const onChartClick = (params, chart) => {
    let clickedValue = params.name;
    if (clickedValue && typeof clickedValue === 'object') {
      clickedValue = clickedValue.value || clickedValue.text || JSON.stringify(clickedValue);
    }
    if (!clickedValue) return;
    clickedValue = String(clickedValue).strip ? String(clickedValue).strip() : String(clickedValue).trim();
    const xColumnName = chart.x || "فئة";
    const colDef = allColumns.find(c => c.name === xColumnName);
    if (colDef?.type === 'numeric' || colDef?.type === 'integer') clickedValue = Number(clickedValue);
    const currentLevel = breadcrumbs[breadcrumbs.length - 1];
    const filterKey = JSON.stringify({ ...currentLevel.filter, [xColumnName]: clickedValue });
    const newLevelId = `level_${Array.from(filterKey).reduce((acc, ch) => ((acc << 5) - acc) + ch.charCodeAt(0) | 0, 0)}`;
    const newLevel = { id: newLevelId, name: `${xColumnName}: ${clickedValue}`, filter: { ...currentLevel.filter, [xColumnName]: clickedValue } };
    setBreadcrumbs([...breadcrumbs, newLevel]);
  };

  const handleColumnFilterChange = (colName, filterConfig) => {
    if (activeTreeId) {
      setChartTrees(prev => prev.map(t => {
        if (t.id !== activeTreeId) return t;
        const filters = { ...((t.structure?.column_filters) || {}) };
        if (filterConfig === null) delete filters[colName];
        else filters[colName] = filterConfig;
        const newStructure = { ...(t.structure || {}), column_filters: filters };
        debouncedSaveTreeConfig(newStructure);
        return { ...t, structure: newStructure };
      }));
    }
  };

  const handleDeleteColumn = (colName) => {
    if (activeTreeId) {
      setChartTrees(prev => prev.map(t => {
        if (t.id !== activeTreeId) return t;
        const deleted = [...((t.structure?.deleted_columns) || []), colName];
        const filters = { ...(t.structure?.column_filters || {}) };
        delete filters[colName];
        const newStructure = { ...(t.structure || {}), deleted_columns: deleted, column_filters: filters };
        apiPut(`/api/global-chart-trees/${activeTreeId}`, { structure: newStructure });
        return { ...t, structure: newStructure };
      }));
    }
  };

  const handleRestoreColumn = (colName) => {
    if (activeTreeId) {
      setChartTrees(prev => prev.map(t => {
        if (t.id !== activeTreeId) return t;
        const deleted = (t.structure?.deleted_columns || []).filter(dc => dc !== colName);
        const newStructure = { ...(t.structure || {}), deleted_columns: deleted };
        apiPut(`/api/global-chart-trees/${activeTreeId}`, { structure: newStructure });
        return { ...t, structure: newStructure };
      }));
    }
  };

  if (!isLoggedIn) {
    return <Login onLogin={handleLogin} />;
  }

  const renderHeaderButtons = () => {
    if (page === 'users' || page === 'upload' || page === 'analysis') return null;
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPage('files')}
          className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-colors ${
            page === 'files' ? 'bg-white text-[#054239]' : 'bg-[#428177] hover:bg-[#1f5f54] text-white'
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5 inline ml-1" /> ملفات البيانات
        </button>
        <button
          onClick={() => { goHome(); }}
          className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-colors ${
            page === 'projects' || page === 'project-detail' ? 'bg-white text-[#054239]' : 'bg-[#428177] hover:bg-[#1f5f54] text-white'
          }`}
        >
          <FolderKanban className="w-3.5 h-3.5 inline ml-1" /> المشاريع
        </button>
        <button
          onClick={() => setPage('templates')}
          className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-colors ${
            page === 'templates' ? 'bg-white text-[#054239]' : 'bg-[#428177] hover:bg-[#1f5f54] text-white'
          }`}
        >
          <FileText className="w-3.5 h-3.5 inline ml-1" /> القوالب
        </button>
        <button
          onClick={() => setPage('shared-dashboards')}
          className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-colors ${
            page === 'shared-dashboards' || page === 'dashboard-viewer' ? 'bg-white text-[#054239]' : 'bg-[#428177] hover:bg-[#1f5f54] text-white'
          }`}
        >
          <LayoutDashboard className="w-3.5 h-3.5 inline ml-1" /> اللوحات المشتركة معي
        </button>
      </div>
    );
  };

  if (page === 'users') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-right" dir="rtl">
        <header className="bg-[#054239] text-white shadow-md px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-8 h-8 text-[#988561]" />
            <h1 className="text-lg font-bold">منظومة BI الذكية للتنقيب الهرمي</h1>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={goHome} className="text-xs bg-[#428177] hover:bg-[#1f5f54] px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors">
              <Home className="w-3.5 h-3.5" /> الرئيسية
            </button>
            <span className="text-xs text-[#988561] font-bold ml-2">{user?.full_name || user?.username}</span>
            <button onClick={handleLogout} className="text-xs text-red-300 hover:text-red-100 transition-colors flex items-center gap-1">
              <LogOut className="w-3.5 h-3.5" /> خروج
          </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          <UserManagement onBack={goHome} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-right" dir="rtl">
      {analysisLoadingMsg && (
        <div className="fixed inset-0 bg-white/80 z-50 flex flex-col items-center justify-center">
          <Loader2 className="w-12 h-12 animate-spin text-[#428177] mb-4" />
          <p className="text-lg font-bold text-[#002623]">{analysisLoadingMsg}</p>
          <p className="text-xs text-gray-400 mt-2">قد تستغرق هذه العملية بعض الوقت للملفات الكبيرة</p>
        </div>
      )}
      <header className="bg-[#054239] text-white shadow-md px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-8 h-8 text-[#988561]" />
          <h1 className="text-lg font-bold">منظومة BI الذكية للتنقيب الهرمي</h1>
        </div>
        <div className="flex items-center gap-3">
          {renderHeaderButtons()}
          <span className="text-xs text-[#988561] font-bold ml-2">{user?.full_name || user?.username}</span>
          <button onClick={handleLogout} className="text-xs text-red-300 hover:text-red-100 transition-colors flex items-center gap-1">
              <LogOut className="w-3.5 h-3.5" /> خروج
            </button>
          </div>
        </header>

      {page === 'analysis' && fileUploaded && isAnalysisStarted && (
        <div className="bg-[#054239]/95 text-white px-6 py-2 flex items-center gap-3 border-t border-[#428177]/30">
          <div className="flex items-center gap-2 ml-2 pl-2 border-l border-[#428177]/30">
            <button
              onClick={() => setPage('files')}
              className={`text-xs px-2 py-1 rounded font-bold transition-colors ${
                page === 'files' ? 'bg-white text-[#054239]' : 'bg-[#428177] hover:bg-[#1f5f54] text-white'
              }`}
            >
              <FileSpreadsheet className="w-3 h-3 inline ml-1" /> ملفات البيانات
            </button>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto max-w-[60%]">
            {activeProject && (
              <div className="flex items-center gap-1 ml-2 pl-2 border-l border-[#428177]/30 text-[#988561] text-xs font-bold whitespace-nowrap">
                <FolderKanban className="w-3.5 h-3.5" />
                <span>{activeProject?.name}</span>
              </div>
            )}
            {activeProject && (() => {
              const fileIds = [...new Set((chartTrees.length > 0 ? chartTrees : (activeProject?.files || [])).map(t => t.file_id || t.id))];
              return fileIds.map(fid => {
                const file = activeProject?.files?.find(f => f.id === fid);
                const fileTabs = chartTrees.filter(t => t.file_id === fid);
                const isExpanded = expandedFiles[fid] !== false;
                return (
                  <div key={fid} className="flex flex-col">
                    <button
                      onClick={() => setExpandedFiles(prev => ({ ...prev, [fid]: !isExpanded }))}
                      className="flex items-center gap-1 px-2 py-1 text-xs font-bold text-white/70 hover:text-white whitespace-nowrap"
                    >
                      <FileSpreadsheet className="w-3 h-3" />
                      {file?.name || `ملف #${fid}`}
                      <span className="text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                    </button>
                    {isExpanded && (
                      <div className="flex gap-1 pr-3">
                        {fileTabs.map(tree => (
                          <button
                            key={tree.id}
                            onClick={() => switchProjectTab(tree.id, tree.file_id)}
                            className={`group relative px-2.5 py-1 text-xs font-bold transition-colors whitespace-nowrap ${
                              activeTreeId === tree.id
                                ? 'bg-gray-50 text-[#054239] rounded-t-lg'
                                : 'bg-[#054239]/60 text-white/70 hover:bg-[#054239]/80 rounded-t-lg'
                            }`}
                          >
                            {tree.tree_name}
                            <span
                              onClick={(e) => { e.stopPropagation(); handleDeleteChartTree(tree.id); }}
                              className="absolute -top-1.5 -left-1.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer bg-red-500 text-white rounded-full p-0.5"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
          <div className="flex-1" />
          <Breadcrumbs crumbs={breadcrumbs} onCrumbClick={(idx) => { setBreadcrumbs(breadcrumbs.slice(0, idx + 1)); }} />
        </div>
      )}

      <div className="flex-1 flex overflow-hidden max-h-screen">
        {page === 'analysis' && fileUploaded && (
          <>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="fixed bottom-4 left-4 z-50 lg:hidden bg-[#054239] text-white p-3 rounded-full shadow-lg hover:bg-[#002623] transition-colors"
            >
              {sidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeft className="w-5 h-5" />}
            </button>

            {sidebarOpen && (
              <div
                className="fixed inset-0 bg-black/30 z-30 lg:hidden"
                onClick={() => setSidebarOpen(false)}
              />
            )}

            <div className={`${sidebarOpen ? 'fixed inset-y-0 right-0 z-40' : 'hidden'} lg:relative lg:block`}>
              {!isAnalysisStarted ? (
                <Sidebar
                  isAnalysisStarted={isAnalysisStarted}
                  allColumns={allColumns}
                  token={token} fileId={fileId}
                />
              ) : (
                <Sidebar
                  isAnalysisStarted={isAnalysisStarted}
                  selectedX={selectedX} setSelectedX={setSelectedX} selectedY={selectedY} setSelectedY={setSelectedY}
                  chartType={chartType} setChartType={setChartType} chartTitle={chartTitle} setChartTitle={setChartTitle}
                  themeColor={themeColor} setThemeColor={setThemeColor} fontSize={fontSize} setFontSize={setFontSize}
                  compatibleCharts={getCompatibleCharts()} onAddChart={handleAddChart}
                  allColumns={allColumns}
                  onDeleteColumn={handleDeleteColumn}
                  onRestoreColumn={handleRestoreColumn}
                  chartWidth={chartWidth} setChartWidth={setChartWidth}
                  chartHeight={chartHeight} setChartHeight={setChartHeight}
                  barWidth={barWidth} setBarWidth={setBarWidth}
                  colorMode={colorMode} setColorMode={setColorMode}
                  customCategoryColors={customCategoryColors} setCustomCategoryColors={setCustomCategoryColors}
                  fontFamily={fontFamily} setFontFamily={setFontFamily}
                  fonts={fonts}
                  onFontAdded={refreshFonts}
                  token={token} fileId={fileId}
                  columnFilters={treeColumnFilters}
                  onColumnFilterChange={handleColumnFilterChange}
                  deletedColumnNames={treeDeletedColumns}
                />
              )}
            </div>
          </>
        )}

        <main className="flex-1 p-6 overflow-y-auto">
          {page === 'files' && (
            <FileList
              onSelectFile={handleSelectFile}
              onShowUpload={() => setPage('upload')}
              onShowUsers={() => setPage('users')}
              isAdmin={isAdmin}
            />
          )}

          {page === 'upload' && (
            <div className="max-w-4xl mx-auto">
              <div className="mb-4">
                <button
                  onClick={() => setPage('files')}
                  className="text-sm text-[#428177] hover:text-[#054239] flex items-center gap-1 transition-colors font-bold"
                >
                  <ArrowLeft className="w-4 h-4" /> العودة للملفات
                </button>
              </div>
              <FileUpload onUploadSuccess={handleUploadSuccess} loading={loading} setLoading={setLoading} fileName={fileName} token={token} projectId={activeProjectId} />
            </div>
          )}

          {page === 'projects' && (
            <ProjectList
              onSelectProject={handleSelectProject}
              onShowUpload={() => setPage('upload')}
              onShowUsers={() => setPage('users')}
              isAdmin={isAdmin}
              user={user}
            />
          )}

          {page === 'project-detail' && activeProject && (
            <ProjectDetail
              project={activeProject}
              onBack={() => setPage('projects')}
              onOpenTab={handleOpenProjectTab}
              onEnterCharts={handleEnterProjectCharts}
              onOpenReports={handleOpenReports}
              onOpenDashboards={handleOpenDashboards}
              isAdmin={isAdmin}
            />
          )}

          {page === 'reports' && reportsProject && (
            <ReportList
              project={reportsProject}
              onBack={handleBackFromReports}
              onOpenReport={handleOpenReport}
              isAdmin={isAdmin}
            />
          )}

          {page === 'dashboards' && dashboardsProject && (
            <DashboardList
              project={dashboardsProject}
              onBack={handleBackFromDashboards}
              onOpenDashboard={handleOpenDashboard}
            />
          )}

          {page === 'dashboard-editor' && activeDashboard && dashboardsProject && (
            <DashboardEditor
              dashboard={activeDashboard}
              project={dashboardsProject}
              onBack={() => setPage('dashboards')}
            />
          )}

          {page === 'shared-dashboards' && (
            <SharedDashboards onOpenDashboard={handleViewSharedDashboard} />
          )}

          {page === 'dashboard-viewer' && viewerDashboardId && (
            <DashboardViewer
              dashboardId={viewerDashboardId}
              onBack={() => setPage('shared-dashboards')}
            />
          )}

          {page === 'templates' && (
            <TemplateList
              onOpenTemplate={handleOpenReport}
              onBack={() => setPage('projects')}
              isAdmin={isAdmin}
            />
          )}

          {page === 'report-editor' && activeReport && (
            <ReportEditor
              report={activeReport}
              project={activeReport?.is_template ? null : activeProject}
              onBack={handleBackFromEditor}
              fonts={fonts}
              isAdmin={isAdmin}
              onFontAdded={refreshFonts}
            />
          )}

          {page === 'analysis' && !fileUploaded && !isAnalysisStarted && loading && (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-[#428177] mb-3" />
          <p className="text-sm font-bold text-[#002623]">جاري تحميل بيانات الملف...</p>
          <p className="text-xs text-gray-400 mt-1">قد تستغرق هذه العملية بعض الوقت للملفات الكبيرة</p>
            </div>
          )}

          {page === 'analysis' && fileUploaded && !isAnalysisStarted && (
            <div className="space-y-6">
              <div className="flex items-center gap-2 mb-4">
                <button onClick={goHome} className="text-sm text-[#428177] hover:text-[#054239] flex items-center gap-1 transition-colors font-bold">
                  <ArrowLeft className="w-4 h-4" /> العودة للملفات
                </button>
              </div>
              <div className="bg-white p-5 border border-gray-200 rounded-xl flex justify-between items-center shadow-sm">
                <div>
              <h3 className="font-bold text-[#002623]">تم تحليل بنية الجدول بنجاح: <span className="text-[#428177]">{allColumns.length}</span> أعمدة</h3>
              <p className="text-xs text-gray-400 mt-1">الملف مكون من {dataSummary.rows} أسطر بيانية مصدرها بايثون</p>
                </div>
                <button onClick={handleStartAnalysis} className="bg-[#054239] hover:bg-[#002623] text-white font-bold text-sm px-6 py-3 rounded-xl shadow-md transition-colors">
              بدء تحليل البيانات وإنشاء المخططات
                </button>
              </div>

              <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
            <div className="bg-gray-50 p-3 border-b text-sm font-bold text-[#002623]">معاينة الهيكل الصدري للبيانات (أقل 5 صفوف)</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm">
                    <thead className="bg-[#054239] text-white text-xs">
                      <tr>
                        {allColumns.map(col => <th key={col.name} className="p-3 border-l border-[#428177]">{col.name}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y text-gray-600">
                      {dataPreview.map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50/50">
                          {allColumns.map(col => <td key={col.name} className="p-3 border-l max-w-xs truncate">{row[col.name]}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {page === 'analysis' && fileUploaded && isAnalysisStarted && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <button onClick={goHome} className="text-sm text-[#428177] hover:text-[#054239] flex items-center gap-1 transition-colors font-bold">
              <Home className="w-3.5 h-3.5" /> الرئيسية
                </button>
              </div>
              <div className="bg-white p-4 border border-gray-200 rounded-xl flex justify-between items-center shadow-sm">
                <div>
              <h3 className="font-bold text-[#002623] text-sm">المخططات المتفاعلة في عقدة: <span className="text-[#428177] font-extrabold">{breadcrumbs[breadcrumbs.length - 1].name}</span></h3>
              <p className="text-xs text-gray-400 mt-0.5">يمكنك تصفية البيانات هرمياً بالنقر على أقسام المخططات.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowNodeTable(!showNodeTable)}
                    className={`flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-lg border transition-all shadow-sm
                      ${showNodeTable ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                  >
                    {showNodeTable ? <EyeOff className="w-4 h-4" /> : <Table className="w-4 h-4" />}
                    {showNodeTable ? 'إخفاء جدول البيانات الحالي' : '📄 عرض جدول البيانات لهذه العقدة'}
                  </button>
                </div>
              </div>

              {/* Derive table columns by intersecting allColumns metadata with actual keys from live data rows.
                  This guards against stale cached columns_json diverging from the parquet/CSV source. */}
              {showNodeTable && (() => {
                const tableColumns = nodeTableData.length > 0
                  ? allColumns.filter(c => c.name in nodeTableData[0])
                  : allColumns;
                return (
                <div className="bg-white border border-amber-100 rounded-xl overflow-hidden shadow-md transition-all animate-fadeIn">
                  <div className="bg-amber-50/50 p-3 border-b border-amber-100 text-xs font-bold text-amber-900 flex justify-between items-center">
            <span>📋 السجلات الفعلية المفلترة (يعرض أول 50 صفاً من أصل {nodeTableRowsCount === -1 ? 'أكثر من 50' : nodeTableRowsCount} سجل مطابق للفلاتر الحالية)</span>
                    {!loadingTable && nodeTableData.length > 0 && visibleRowCount < nodeTableData.length && (
            <span className="text-amber-600 text-[10px]">جاري تحميل باقي الصفوف...</span>
                    )}
                  </div>
                  {loadingTable ? (
                    <div className="p-12 flex justify-center items-center gap-2 text-gray-500 text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-[#428177]" /> جاري فلترة واستخراج السجلات من البايثون...
                    </div>
                  ) : tableError ? (
                    <div className="p-8 text-center">
                      <p className="text-red-500 text-sm font-bold">{tableError}</p>
                    </div>
                  ) : nodeTableData.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-xs">لا توجد سجلات مطابقة للفلاتر الحالية.</div>
                  ) : tableColumns.length === 0 ? (
            <div className="p-8 text-center text-amber-600 text-xs">تم تحميل البيانات ولكن لا تتطابق أسماء الأعمدة مع تعريفاتها.</div>
                  ) : (
                    <div className="overflow-x-auto max-h-72">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-gray-100 text-gray-700 font-bold sticky top-0 border-b">
                          <tr>
                            {tableColumns.map(col => <th key={col.name} className="p-2.5 border-l">{col.name}</th>)}
                          </tr>
                        </thead>
                        <tbody className="divide-y text-gray-600">
                          {nodeTableData.slice(0, visibleRowCount).map((row, idx) => (
                            <tr key={fileId + '-' + idx} className="hover:bg-amber-50/20">
                              {tableColumns.map(col => <td key={col.name} className="p-2 border-l max-w-xs truncate">{row[col.name]}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                );
              })()}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {charts
                  .filter(c => c.levelId === breadcrumbs[breadcrumbs.length - 1].id)
                  .map(chart => (
                    <ChartView
                      key={chart.id}
                      chart={chart}
                      chartData={chartDataMap[chart.id]}
                      currentFilters={breadcrumbs[breadcrumbs.length - 1].filter}
                      globalFilters={treeColumnFilters}
                      onChartClick={onChartClick}
                      onDelete={handleDeleteChart}
                      onEdit={() => handleEditClick(chart)}
                      token={token}
                      fileId={fileId}
                    />
                  ))}
              </div>
            </div>
          )}
        </main>
      </div>
      {editingChart && (
        <ChartEditModal
          chart={editingChart}
          allColumns={allColumns.filter(c => !treeDeletedColumns.includes(c.name))}
          onSave={handleUpdateChart}
          onCancel={() => { setEditingChart(null); clearSidebarFields(); }}
          fonts={fonts}
          onFontAdded={refreshFonts}
          fileId={fileId}
        />
      )}
      {showFontManager && (
        <FontManager
          isAdmin={isAdmin}
          onFontAdded={refreshFonts}
          onClose={() => setShowFontManager(false)}
        />
      )}
    </div>
  );
}

