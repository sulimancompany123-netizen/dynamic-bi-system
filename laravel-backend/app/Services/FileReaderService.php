<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class FileReaderService
{
    protected string $scriptPath;
    protected string $cacheDir;

    protected static $daemonProcess = null;
    protected static $daemonPipes = null;

    protected bool $forceSubprocess = false;

    public function __construct()
    {
        $this->scriptPath = base_path('python-scripts/main.py');
        $this->cacheDir = storage_path('app/cache');
        if (!is_dir($this->cacheDir)) {
            mkdir($this->cacheDir, 0755, true);
        }
        if (self::$daemonProcess === null) {
            register_shutdown_function(function () {
                $this->shutdownDaemon();
            });
        }
    }

    public function __destruct()
    {
        // cleanup handled by shutdown function
    }

    protected function addCacheDir(array $args): array
    {
        $args['cache-dir'] = $this->cacheDir;
        return $args;
    }

    /**
     * Build the child-process environment. proc_open() REPLACES the environment when an
     * array is given (it does not merge), so passing only PYTHONIOENCODING would strip
     * PATH/SystemRoot and can break native extension loading (pyarrow, calamine) on Windows.
     * Inherit the current environment and just add the encoding override.
     */
    protected function buildEnv(): array
    {
        $env = getenv();
        if (!is_array($env)) {
            $env = [];
        }
        $env['PYTHONIOENCODING'] = 'utf-8';
        return $env;
    }

    protected function getDaemon(): array
    {
        if (self::$daemonProcess !== null) {
            $status = proc_get_status(self::$daemonProcess);
            if ($status !== false && $status['running']) {
                return ['process' => self::$daemonProcess, 'pipes' => self::$daemonPipes];
            }
            $this->shutdownDaemon();
        }

        $cmd = ['python', $this->scriptPath, '--daemon'];
        // Send the daemon's stderr to a log file rather than a pipe: a long-lived daemon
        // whose stderr pipe is never fully drained can deadlock once the OS pipe buffer
        // fills (e.g. Excel readers emitting warnings), which blocks the stdout response.
        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['file', $this->cacheDir . DIRECTORY_SEPARATOR . 'daemon-stderr.log', 'a'],
        ];
        $env = $this->buildEnv();

        $process = proc_open($cmd, $descriptors, $pipes, null, $env);
        if (!is_resource($process)) {
            throw new \RuntimeException('Failed to start Python daemon');
        }

        stream_set_blocking($pipes[0], false);
        stream_set_blocking($pipes[1], false);

        self::$daemonProcess = $process;
        self::$daemonPipes = $pipes;

        return ['process' => $process, 'pipes' => $pipes];
    }

    protected function shutdownDaemon(): void
    {
        if (self::$daemonPipes !== null) {
            if (is_resource(self::$daemonPipes[0])) {
                fwrite(self::$daemonPipes[0], json_encode(['command' => 'shutdown']) . "\n");
                fflush(self::$daemonPipes[0]);
                fclose(self::$daemonPipes[0]);
            }
            if (is_resource(self::$daemonPipes[1])) {
                fclose(self::$daemonPipes[1]);
            }
            self::$daemonPipes = null;
        }
        if (self::$daemonProcess !== null) {
            proc_close(self::$daemonProcess);
            self::$daemonProcess = null;
        }
    }

    protected function run(string $command, array $args): array
    {
        $args = $this->addCacheDir($args);

        if ($this->forceSubprocess) {
            return $this->runSubprocess($command, $args);
        }

        try {
            return $this->runWithDaemon($command, $args);
        } catch (\RuntimeException $e) {
            Log::error("Daemon failed for command {$command}, falling back to subprocess: {$e->getMessage()}");
            return $this->runSubprocess($command, $args);
        }
    }

    protected function runWithDaemon(string $command, array $args): array
    {
        $daemon = $this->getDaemon();
        $pipes = $daemon['pipes'];

        $request = json_encode(['command' => $command, 'args' => $args]) . "\n";

        $writeTimeout = 1.0;
        $writeStart = microtime(true);
        $written = 0;
        $requestLen = strlen($request);
        while ($written < $requestLen) {
            if (microtime(true) - $writeStart > $writeTimeout) {
                $this->shutdownDaemon();
                throw new \RuntimeException("Daemon write timed out after {$writeTimeout}s for command: {$command}");
            }
            $result = @fwrite($pipes[0], substr($request, $written));
            if ($result === false || $result === 0) {
                $this->shutdownDaemon();
                throw new \RuntimeException('Daemon pipe write failed, will fall back to subprocess');
            }
            $written += $result;
        }
        fflush($pipes[0]);

        $output = '';
        $startTime = microtime(true);
        // Heavy commands (Excel parsing, parquet conversion, merges) can legitimately take
        // a while on large files; keep this aligned with the subprocess timeout so we don't
        // tear the daemon down and re-do the work in a subprocess.
        $timeout = 300;

        while (true) {
            $elapsed = microtime(true) - $startTime;
            if ($elapsed > $timeout) {
                Log::error('Daemon timed out', ['command' => $command, 'elapsed' => $elapsed]);
                $this->shutdownDaemon();
                throw new \RuntimeException("Daemon timed out after {$timeout}s for command: {$command}");
            }

            $read = [$pipes[1]];
            $write = null;
            $except = null;

            $changed = @stream_select($read, $write, $except, 0, 200000);
            if ($changed === false) {
                $this->shutdownDaemon();
                throw new \RuntimeException('stream_select failed for daemon pipes');
            }

            if ($changed > 0) {
                $chunk = @fread($pipes[1], 8192);
                if ($chunk === false || $chunk === '') {
                    if (feof($pipes[1])) {
                        break;
                    }
                } else {
                    $output .= $chunk;
                    if (str_ends_with($output, "\n")) {
                        break;
                    }
                }
            }
        }

        $response = json_decode(trim($output), true);
        if (!is_array($response)) {
            throw new \RuntimeException("Invalid JSON response from daemon: {$output}");
        }
        if (($response['status'] ?? '') === 'error') {
            throw new \RuntimeException($response['detail'] ?? 'Unknown daemon error');
        }
        return $response;
    }

    protected function runSubprocess(string $command, array $args): array
    {
        $cliArgs = [$command];
        foreach ($args as $key => $value) {
            $cliArgs[] = "--{$key}";
            $cliArgs[] = (string)$value;
        }

        $cmd = ['python', $this->scriptPath, ...$cliArgs];

        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];

        $env = $this->buildEnv();

        $process = proc_open($cmd, $descriptors, $pipes, null, $env);

        if (!is_resource($process)) {
            throw new \RuntimeException("Failed to start Python process for command: {$command}");
        }

        fclose($pipes[0]);

        $output = '';
        $errorOutput = '';
        $startTime = microtime(true);
        $timeout = 300;

        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);

        while (true) {
            $status = proc_get_status($process);

            if (!$status['running']) {
                $output .= stream_get_contents($pipes[1]);
                $errorOutput .= stream_get_contents($pipes[2]);
                break;
            }

            if (microtime(true) - $startTime > $timeout) {
                proc_terminate($process);
                fclose($pipes[1]);
                fclose($pipes[2]);
                proc_close($process);
                throw new \RuntimeException("Python script timed out after {$timeout} seconds for command: {$command}");
            }

            $read = [$pipes[1], $pipes[2]];
            $write = null;
            $except = null;

            if (stream_select($read, $write, $except, 0, 50000) > 0) {
                foreach ($read as $pipe) {
                    $chunk = fread($pipe, 8192);
                    if ($pipe === $pipes[1]) {
                        $output .= $chunk;
                    } else {
                        $errorOutput .= $chunk;
                    }
                }
            } else {
                usleep(50000);
            }
        }

        fclose($pipes[1]);
        fclose($pipes[2]);

        $exitCode = proc_close($process);

        if ($exitCode !== 0) {
            if ($errorOutput) {
                Log::error('Python Subprocess Stderr', ['command' => $command, 'stderr' => $errorOutput]);
            }
            $decodedOutput = json_decode($output, true);
            $errorDetail = is_array($decodedOutput) && isset($decodedOutput['detail'])
                ? $decodedOutput['detail']
                : ($errorOutput ?: $output);
            throw new \RuntimeException("Python script error: {$errorDetail}");
        }

        return json_decode($output, true) ?? [];
    }

    public function inspect(string $filePath): array
    {
        return $this->run('inspect', ['path' => $filePath]);
    }

    public function sheetData(string $filePath, string $sheet): array
    {
        $effectivePath = $this->ensureParquet($filePath, $sheet);
        $effectiveSheet = str_ends_with($effectivePath, '.parquet') ? '' : $sheet;
        return $this->run('sheet-data', ['path' => $effectivePath, 'sheet' => $effectiveSheet]);
    }

    protected function jsonPath(string $column): string
    {
        return '$."' . str_replace(['"', '\\'], ['\\"', '\\\\'], $column) . '"';
    }

    public function chartDataFromDb(int $fileId, array $charts, array $filters = []): array
    {
        $results = [];
        foreach ($charts as $chartConfig) {
            $chartId = $chartConfig['id'];
            $xColumn = $chartConfig['x'];
            $yColumn = $chartConfig['y'] ?? '';

            $query = DB::table('file_data_rows')->where('file_id', $fileId);

            foreach ($filters as $col => $val) {
                $colPath = $this->jsonPath($col);
                if (is_array($val) && isset($val['selected'])) {
                    $selected = array_map(fn($s) => (string)$s, $val['selected']);
                    if (!empty($selected)) {
                        $placeholders = implode(',', array_fill(0, count($selected), '?'));
                        $query->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(data, ?)) IN ({$placeholders})", array_merge([$colPath], $selected));
                    }
                } elseif (is_array($val) && isset($val['min'])) {
                    $min = (float)$val['min'];
                    $max = isset($val['max']) ? (float)$val['max'] : null;
                    $query->whereRaw("CAST(JSON_EXTRACT(data, ?) AS DECIMAL(20,6)) >= ?", [$colPath, $min]);
                    if ($max !== null) {
                        $query->whereRaw("CAST(JSON_EXTRACT(data, ?) AS DECIMAL(20,6)) <= ?", [$colPath, $max]);
                    }
                } else {
                    $query->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(data, ?)) = ?", [$colPath, (string)$val]);
                }
            }

            $xPath = $this->jsonPath($xColumn);

            if (!$yColumn || $yColumn === '' || $yColumn === 'null') {
                $rows = $query->select(DB::raw("JSON_UNQUOTE(JSON_EXTRACT(data, '{$xPath}')) as x_value, COUNT(*) as y_value"))
                    ->groupBy(DB::raw("JSON_UNQUOTE(JSON_EXTRACT(data, '{$xPath}'))"))
                    ->orderByDesc('y_value')
                    ->limit(15)
                    ->get();
                $results[$chartId] = [
                    'x_data' => $rows->pluck('x_value')->map(fn($v) => (string)$v)->toArray(),
                    'y_data' => $rows->pluck('y_value')->map(fn($v) => (int)$v)->toArray(),
                    'series_name' => (string)$xColumn,
                ];
            } else {
                $yPath = $this->jsonPath($yColumn);
                $rows = $query->select(DB::raw("JSON_UNQUOTE(JSON_EXTRACT(data, '{$xPath}')) as x_value, AVG(CAST(JSON_EXTRACT(data, '{$yPath}') AS DECIMAL(20,6))) as y_value"))
                    ->groupBy(DB::raw("JSON_UNQUOTE(JSON_EXTRACT(data, '{$xPath}'))"))
                    ->orderByDesc('y_value')
                    ->limit(15)
                    ->get();
                $results[$chartId] = [
                    'x_data' => $rows->pluck('x_value')->map(fn($v) => (string)$v)->toArray(),
                    'y_data' => $rows->pluck('y_value')->map(fn($v) => round((float)$v, 2))->toArray(),
                    'series_name' => "Average of $yColumn",
                ];
            }
        }

        return ['status' => 'success', 'charts' => $results];
    }

    public function tableDataFromDb(int $fileId, array $filters = []): array
    {
        $baseQuery = DB::table('file_data_rows')->where('file_id', $fileId);

        foreach ($filters as $col => $val) {
            $colPath = $this->jsonPath($col);
            if (is_array($val) && isset($val['selected'])) {
                $selected = array_map(fn($s) => (string)$s, $val['selected']);
                if (!empty($selected)) {
                    $placeholders = implode(',', array_fill(0, count($selected), '?'));
                    $baseQuery->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(data, ?)) IN ({$placeholders})", array_merge([$colPath], $selected));
                }
            } elseif (is_array($val) && isset($val['min'])) {
                $min = (float)$val['min'];
                $max = isset($val['max']) ? (float)$val['max'] : null;
                $baseQuery->whereRaw("CAST(JSON_EXTRACT(data, ?) AS DECIMAL(20,6)) >= ?", [$colPath, $min]);
                if ($max !== null) {
                    $baseQuery->whereRaw("CAST(JSON_EXTRACT(data, ?) AS DECIMAL(20,6)) <= ?", [$colPath, $max]);
                }
            } else {
                $baseQuery->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(data, ?)) = ?", [$colPath, (string)$val]);
            }
        }

        $rows = (clone $baseQuery)
            ->select('data')
            ->orderBy('row_index')
            ->limit(51)
            ->get();

        if ($rows->count() > 50) {
            $totalFilteredRows = -1;
            $dataRows = $rows->take(50);
        } else {
            $totalFilteredRows = $rows->count();
            $dataRows = $rows;
        }

        $data = $dataRows->map(fn($r) => json_decode($r->data, true))->toArray();

        return [
            'status' => 'success',
            'total_filtered_rows' => $totalFilteredRows,
            'data' => $data,
        ];
    }

    protected function resolveFileId(string $filePath): ?int
    {
        $file = \App\Models\DataFile::where('file_path', $filePath)->first();
        return $file ? $file->id : null;
    }

    public function importToDb(string $filePath, string $sheet, int $fileId): array
    {
        return $this->run('import-to-db', [
            'path' => $filePath,
            'sheet' => $sheet,
            'file-id' => (string) $fileId,
            'db-host' => config('database.connections.mysql.host', '127.0.0.1'),
            'db-user' => config('database.connections.mysql.username', 'root'),
            'db-password' => config('database.connections.mysql.password', ''),
            'db-database' => config('database.connections.mysql.database', 'bi_drilldown'),
        ]);
    }

    public function tableData(string $filePath, string $sheet, array $filters = [], array $columns = []): array
    {
        $fileId = $this->resolveFileId($filePath);
        if ($fileId !== null && DB::table('file_data_rows')->where('file_id', $fileId)->exists()) {
            return $this->tableDataFromDb($fileId, $filters);
        }
        $effectivePath = $this->ensureParquet($filePath, $sheet);
        $effectiveSheet = str_ends_with($effectivePath, '.parquet') ? '' : $sheet;
        $args = [
            'path' => $effectivePath,
            'sheet' => $effectiveSheet,
            'filters' => base64_encode(json_encode(empty($filters) ? new \stdClass() : $filters)),
            'columns' => base64_encode(json_encode(array_values($columns))),
        ];
        return $this->run('table-data', $args);
    }

    public function chartData(string $filePath, string $sheet, string $x, ?string $y = null, array $filters = []): array
    {
        $fileId = $this->resolveFileId($filePath);
        if ($fileId !== null && DB::table('file_data_rows')->where('file_id', $fileId)->exists()) {
            $result = $this->chartDataFromDb($fileId, [['id' => 'single', 'x' => $x, 'y' => $y ?? '']], $filters);
            if (isset($result['charts']['single'])) {
                return ['status' => 'success', 'x_data' => $result['charts']['single']['x_data'], 'y_data' => $result['charts']['single']['y_data'], 'series_name' => $result['charts']['single']['series_name']];
            }
            return ['status' => 'success', 'x_data' => [], 'y_data' => [], 'series_name' => (string)$x];
        }
        $effectivePath = $this->ensureParquet($filePath, $sheet);
        $effectiveSheet = str_ends_with($effectivePath, '.parquet') ? '' : $sheet;
        return $this->run('chart-data', [
            'path' => $effectivePath,
            'sheet' => $effectiveSheet,
            'x' => $x,
            'y' => $y ?? '',
            'filters' => base64_encode(json_encode(empty($filters) ? new \stdClass() : $filters)),
        ]);
    }

    public function batchChartData(string $filePath, string $sheet, array $charts, array $filters = []): array
    {
        $fileId = $this->resolveFileId($filePath);
        if ($fileId !== null && DB::table('file_data_rows')->where('file_id', $fileId)->exists()) {
            return $this->chartDataFromDb($fileId, $charts, $filters);
        }
        $effectivePath = $this->ensureParquet($filePath, $sheet);
        $effectiveSheet = str_ends_with($effectivePath, '.parquet') ? '' : $sheet;
        return $this->run('batch-chart-data', [
            'path' => $effectivePath,
            'sheet' => $effectiveSheet,
            'charts' => base64_encode(json_encode($charts)),
            'filters' => base64_encode(json_encode(empty($filters) ? new \stdClass() : $filters)),
        ]);
    }

    /**
     * Compute a batch of KPI card values ([{id, column, metric, value}, ...]) from one
     * file in a single read.
     */
    public function cardMetrics(string $filePath, string $sheet, array $cards, array $filters = []): array
    {
        $effectivePath = $this->ensureParquet($filePath, $sheet);
        $effectiveSheet = str_ends_with($effectivePath, '.parquet') ? '' : $sheet;
        return $this->run('card-metrics', [
            'path' => $effectivePath,
            'sheet' => $effectiveSheet,
            'cards' => base64_encode(json_encode($cards)),
            'filters' => base64_encode(json_encode(empty($filters) ? new \stdClass() : $filters)),
        ]);
    }

    public function sheetColumns(string $filePath, string $sheet): array
    {
        $effectivePath = $this->ensureParquet($filePath, $sheet);
        $effectiveSheet = str_ends_with($effectivePath, '.parquet') ? '' : $sheet;
        return $this->run('sheet-columns', ['path' => $effectivePath, 'sheet' => $effectiveSheet]);
    }

    public function concatSheets(string $filePath, string $sheet1, string $sheet2, string $on, string $how = 'inner'): array
    {
        return $this->run('concat-sheets', [
            'path' => $filePath,
            'sheet1' => $sheet1,
            'sheet2' => $sheet2,
            'on' => $on,
            'how' => $how,
        ]);
    }

    public function mergeMultipleSheets(string $filePath, array $sheets, string $on, string $how = 'inner'): array
    {
        return $this->run('merge-multiple-sheets', [
            'path' => $filePath,
            'sheets' => implode(',', $sheets),
            'on' => $on,
            'how' => $how,
        ]);
    }

    public function mergeMultipleAndSaveCsv(string $filePath, array $sheets, string $on, string $how, string $outputPath): array
    {
        return $this->run('merge-multiple-and-save-csv', [
            'path' => $filePath,
            'sheets' => implode(',', $sheets),
            'on' => $on,
            'how' => $how,
            'output' => $outputPath,
        ]);
    }

    public function columnCategories(string $filePath, string $sheet, string $column): array
    {
        $effectivePath = $this->ensureParquet($filePath, $sheet);
        $effectiveSheet = str_ends_with($effectivePath, '.parquet') ? '' : $sheet;
        return $this->run('column-categories', [
            'path' => $effectivePath,
            'sheet' => $effectiveSheet,
            'column' => $column,
        ]);
    }

    public function columnDetails(string $filePath, string $sheet, string $column): array
    {
        $effectivePath = $this->ensureParquet($filePath, $sheet);
        $effectiveSheet = str_ends_with($effectivePath, '.parquet') ? '' : $sheet;
        return $this->run('column-details', [
            'path' => $effectivePath,
            'sheet' => $effectiveSheet,
            'column' => $column,
        ]);
    }

    public function getSheetName(string $filePath): string
    {
        if (str_ends_with($filePath, '.csv') || str_ends_with($filePath, '.parquet')) {
            return '';
        }
        $result = $this->inspect($filePath);
        if (isset($result['sheets']) && count($result['sheets']) > 0) {
            return $result['sheets'][0];
        }
        return '';
    }

    public function deriveParquetPath(string $filePath): string
    {
        if (str_ends_with($filePath, '.xlsx')) {
            return substr($filePath, 0, -5) . '.parquet';
        }
        if (str_ends_with($filePath, '.xls')) {
            return substr($filePath, 0, -4) . '.parquet';
        }
        if (str_ends_with($filePath, '.csv')) {
            return substr($filePath, 0, -4) . '.parquet';
        }
        return $filePath;
    }

    public function deriveCsvPath(string $filePath): string
    {
        if (str_ends_with($filePath, '.xlsx')) {
            return substr($filePath, 0, -5) . '.csv';
        }
        if (str_ends_with($filePath, '.xls')) {
            return substr($filePath, 0, -4) . '.csv';
        }
        return $filePath;
    }

    protected function ensureCsv(string $filePath, string $sheet): string
    {
        if (str_ends_with($filePath, '.csv')) {
            return $filePath;
        }

        $csvPath = $this->deriveCsvPath($filePath);

        if (file_exists($csvPath) && filemtime($csvPath) >= filemtime($filePath)) {
            return $csvPath;
        }

        $result = $this->convertToCsv($filePath, $sheet, $csvPath);

        if (($result['status'] ?? '') === 'error') {
            throw new \RuntimeException('Excel-to-CSV conversion failed: ' . ($result['detail'] ?? 'unknown'));
        }

        if (!file_exists($csvPath)) {
            throw new \RuntimeException('Excel-to-CSV conversion succeeded but CSV file not found at: ' . $csvPath);
        }

        return $csvPath;
    }

    protected function ensureParquet(string $filePath, string $sheet): string
    {
        if (str_ends_with($filePath, '.parquet')) {
            return $filePath;
        }

        $parquetPath = $this->deriveParquetPath($filePath);

        if (file_exists($parquetPath) && filemtime($parquetPath) >= filemtime($filePath)) {
            \App\Models\DataFile::where('file_path', $filePath)->update(['file_path' => $parquetPath]);
            return $parquetPath;
        }

        $result = $this->convertToParquet($filePath, $sheet, $parquetPath);

        if (($result['status'] ?? '') === 'error') {
            throw new \RuntimeException('Conversion to parquet failed: ' . ($result['detail'] ?? 'unknown'));
        }

        \App\Models\DataFile::where('file_path', $filePath)->update(['file_path' => $parquetPath]);

        return $parquetPath;
    }

    public function convertToParquet(string $filePath, string $sheet, string $outputPath): array
    {
        return $this->run('save-as-parquet', [
            'path' => $filePath,
            'sheet' => $sheet,
            'output' => $outputPath,
        ]);
    }

    public function convertToCsv(string $filePath, string $sheet, string $outputPath): array
    {
        return $this->run('save-as-csv', [
            'path' => $filePath,
            'sheet' => $sheet,
            'output' => $outputPath,
        ]);
    }

    public function mergeAndSaveCsv(string $filePath, string $sheet1, string $sheet2, string $on, string $how, string $outputPath): array
    {
        return $this->run('merge-and-save-csv', [
            'path' => $filePath,
            'sheet1' => $sheet1,
            'sheet2' => $sheet2,
            'on' => $on,
            'how' => $how,
            'output' => $outputPath,
        ]);
    }

    public function mergeAndSaveParquet(string $filePath, string $sheet1, string $sheet2, string $on, string $how, string $outputPath): array
    {
        return $this->run('merge-and-save-parquet', [
            'path' => $filePath,
            'sheet1' => $sheet1,
            'sheet2' => $sheet2,
            'on' => $on,
            'how' => $how,
            'output' => $outputPath,
        ]);
    }

    public function mergeMultipleAndSaveParquet(string $filePath, array $sheets, string $on, string $how, string $outputPath): array
    {
        return $this->run('merge-multiple-and-save-parquet', [
            'path' => $filePath,
            'sheets' => implode(',', $sheets),
            'on' => $on,
            'how' => $how,
            'output' => $outputPath,
        ]);
    }

    public function cleanCsv(string $filePath): array
    {
        return $this->run('clean-csv', ['path' => $filePath]);
    }

    }