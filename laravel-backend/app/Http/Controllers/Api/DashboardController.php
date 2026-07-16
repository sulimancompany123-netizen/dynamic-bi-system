<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Dashboard;
use App\Models\DataFile;
use App\Models\Project;
use App\Models\User;
use App\Services\FileReaderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    /**
     * Default structure for a brand-new dashboard: one empty tab.
     */
    protected function defaultStructure(): array
    {
        return [
            'tabs' => [
                ['id' => 'tab-' . uniqid(), 'name' => 'الرئيسية', 'items' => [], 'columns' => 2],
            ],
        ];
    }

    /**
     * List the dashboards of a project the current user may manage.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['project_id' => 'required|integer|exists:projects,id']);

        $user = $request->user();
        $project = Project::find($request->project_id);
        if (! $project || ! $project->isAccessibleBy($user)) {
            return response()->json(['status' => 'error', 'message' => 'غير مصرح بالوصول إلى لوحات هذا المشروع'], 403);
        }

        $dashboards = Dashboard::where('project_id', $project->id)
            ->withCount('viewers')
            ->orderByDesc('updated_at')
            ->get()
            ->map(fn ($d) => [
                'id' => $d->id,
                'name' => $d->name,
                'project_id' => $d->project_id,
                'tabs_count' => is_array($d->structure['tabs'] ?? null) ? count($d->structure['tabs']) : 0,
                'viewers_count' => $d->viewers_count,
                'updated_at' => $d->updated_at,
            ]);

        return response()->json(['status' => 'success', 'data' => $dashboards]);
    }

    /**
     * List the dashboards that have been shared (granted) to the current user.
     */
    public function shared(Request $request): JsonResponse
    {
        $user = $request->user();

        $dashboards = Dashboard::whereHas('viewers', fn ($q) => $q->where('users.id', $user->id))
            ->with('project:id,name')
            ->orderByDesc('updated_at')
            ->get()
            ->map(fn ($d) => [
                'id' => $d->id,
                'name' => $d->name,
                'project_id' => $d->project_id,
                'project_name' => $d->project?->name,
                'updated_at' => $d->updated_at,
            ]);

        return response()->json(['status' => 'success', 'data' => $dashboards]);
    }

    /**
     * Full dashboard (structure + computed chart data) for anyone allowed to view it.
     */
    public function show(Request $request, int $id): JsonResponse
    {
        $dashboard = Dashboard::with('project')->findOrFail($id);

        if (! $dashboard->viewableBy($request->user())) {
            return response()->json(['status' => 'error', 'message' => 'غير مصرح بالوصول إلى هذه اللوحة'], 403);
        }

        return response()->json([
            'status' => 'success',
            'data' => [
                'id' => $dashboard->id,
                'name' => $dashboard->name,
                'project_id' => $dashboard->project_id,
                'structure' => $dashboard->structure ?? ['tabs' => []],
                'chart_data' => $this->resolveChartData($dashboard),
                'can_manage' => $dashboard->manageableBy($request->user()),
                'updated_at' => $dashboard->updated_at,
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'project_id' => 'required|integer|exists:projects,id',
            'name' => 'required|string|max:255',
        ]);

        $user = $request->user();
        $project = Project::find($validated['project_id']);
        if (! $project || ! $project->isAccessibleBy($user)) {
            return response()->json(['status' => 'error', 'message' => 'غير مصرح بإضافة لوحة إلى هذا المشروع'], 403);
        }

        $dashboard = Dashboard::create([
            'project_id' => $project->id,
            'created_by' => $user->id,
            'name' => $validated['name'],
            'structure' => $this->defaultStructure(),
        ]);

        return response()->json([
            'status' => 'success',
            'data' => ['id' => $dashboard->id, 'name' => $dashboard->name, 'project_id' => $dashboard->project_id],
        ], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $dashboard = Dashboard::with('project')->findOrFail($id);

        if (! $dashboard->manageableBy($request->user())) {
            return response()->json(['status' => 'error', 'message' => 'غير مصرح بتعديل هذه اللوحة'], 403);
        }

        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'structure' => 'sometimes|array',
        ]);

        $dashboard->fill($validated);

        // The structure (and thus which charts it contains) may have changed, so drop
        // the cached chart data; it is recomputed on the next show().
        if (array_key_exists('structure', $validated)) {
            $dashboard->chart_data = null;
            $dashboard->chart_data_cached_at = null;
        }

        $dashboard->save();

        return response()->json([
            'status' => 'success',
            'data' => ['id' => $dashboard->id, 'name' => $dashboard->name, 'structure' => $dashboard->structure],
        ]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $dashboard = Dashboard::with('project')->findOrFail($id);

        if (! $dashboard->manageableBy($request->user())) {
            return response()->json(['status' => 'error', 'message' => 'غير مصرح بحذف هذه اللوحة'], 403);
        }

        $dashboard->delete();

        return response()->json(['status' => 'success', 'message' => 'تم حذف اللوحة']);
    }

    /**
     * List every user plus which of them are currently granted view access, so a
     * manager (admin or project owner) can grant/revoke without the admin-only
     * /users endpoint.
     */
    public function accessIndex(Request $request, int $id): JsonResponse
    {
        $dashboard = Dashboard::with('project')->findOrFail($id);

        if (! $dashboard->manageableBy($request->user())) {
            return response()->json(['status' => 'error', 'message' => 'غير مصرح'], 403);
        }

        $users = User::where('role', '!=', 'admin')
            ->select('id', 'username', 'full_name')
            ->orderBy('full_name')
            ->get();

        $grantedIds = $dashboard->viewers()->pluck('users.id');

        return response()->json([
            'status' => 'success',
            'data' => [
                'users' => $users,
                'granted_ids' => $grantedIds,
            ],
        ]);
    }

    /**
     * Replace the dashboard's set of granted viewers.
     */
    public function accessSync(Request $request, int $id): JsonResponse
    {
        $dashboard = Dashboard::with('project')->findOrFail($id);

        if (! $dashboard->manageableBy($request->user())) {
            return response()->json(['status' => 'error', 'message' => 'غير مصرح'], 403);
        }

        $validated = $request->validate([
            'user_ids' => 'present|array',
            'user_ids.*' => 'integer|exists:users,id',
        ]);

        $dashboard->viewers()->sync($validated['user_ids']);

        return response()->json(['status' => 'success', 'granted_ids' => $validated['user_ids']]);
    }

    /**
     * Return the dashboard's chart data, using the cache when it is still fresh and
     * otherwise recomputing it from the underlying files. Mirrors the caching in
     * GlobalChartTreeController::show — the data stays current when a source file is
     * replaced because a stale/empty cache forces a recompute.
     */
    protected function resolveChartData(Dashboard $dashboard): array
    {
        $cacheValid = $dashboard->chart_data_cached_at !== null
            && $dashboard->updated_at !== null
            && $dashboard->chart_data_cached_at >= $dashboard->updated_at
            && $dashboard->chart_data !== null;

        if ($cacheValid) {
            return $dashboard->chart_data;
        }

        $chartData = $this->computeChartData($dashboard);

        $dashboard->chart_data = $chartData;
        $dashboard->chart_data_cached_at = now();
        $dashboard->saveQuietly();

        return $chartData;
    }

    /**
     * Compute chart data for every chart item across all tabs. Chart items are grouped
     * by their source file so each file is read once (reusing FileReaderService::
     * batchChartData). Results are keyed by the item id, which the frontend matches
     * against each ChartView's id.
     */
    protected function computeChartData(Dashboard $dashboard): array
    {
        $structure = $dashboard->structure ?? [];
        $tabs = $structure['tabs'] ?? [];

        // Group chart configs by file_id: [ file_id => [ {id, x, y}, ... ] ].
        $byFile = [];
        foreach ($tabs as $tab) {
            foreach (($tab['items'] ?? []) as $item) {
                if (($item['type'] ?? null) !== 'chart') {
                    continue;
                }
                $fileId = $item['file_id'] ?? null;
                $config = $item['config'] ?? null;
                if (! $fileId || ! $config || empty($config['id'])) {
                    continue;
                }
                $byFile[$fileId][] = [
                    'id' => $config['id'],
                    'x' => $config['x'] ?? '',
                    'y' => $config['y'] ?? '',
                ];
            }
        }

        if (empty($byFile)) {
            return [];
        }

        $fileReader = app(FileReaderService::class);
        $chartData = [];

        foreach ($byFile as $fileId => $configs) {
            $file = DataFile::find($fileId);
            if (! $file) {
                continue;
            }
            try {
                $sheet = $fileReader->getSheetName($file->file_path);
                $result = $fileReader->batchChartData($file->file_path, $sheet, $configs);
                foreach (($result['charts'] ?? []) as $chartId => $data) {
                    $chartData[$chartId] = $data;
                }
            } catch (\Exception $e) {
                // Skip files that fail to read; their charts simply render "no data".
                continue;
            }
        }

        return $chartData;
    }
}
