<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DataFile;
use App\Models\GlobalChartTree;
use App\Models\Project;
use App\Services\FileReaderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GlobalChartTreeController extends Controller
{
    /**
     * Restrict a tree query to the tabs the user is allowed to see: tabs in a project
     * they own, or (legacy) project-less tabs on a file they uploaded. Admins see all.
     */
    protected function scopeToUser($query, $user)
    {
        if ($user->role === 'admin') {
            return $query;
        }

        return $query->where(function ($q) use ($user) {
            $q->whereHas('project', fn ($p) => $p->where('created_by', $user->id))
                ->orWhere(function ($q2) use ($user) {
                    $q2->whereNull('project_id')
                        ->whereHas('dataFile', fn ($f) => $f->where('uploaded_by', $user->id));
                });
        });
    }

    /**
     * Whether the user may read/modify a specific tab. Admins may access any tab;
     * everyone else needs to own the tab's project (or, for a project-less legacy
     * tab, to have uploaded its file).
     */
    protected function treeAccessibleBy(GlobalChartTree $tree, $user): bool
    {
        if ($user->role === 'admin') {
            return true;
        }

        if ($tree->project_id !== null) {
            return $tree->project()->where('created_by', $user->id)->exists();
        }

        return $tree->dataFile()->where('uploaded_by', $user->id)->exists();
    }
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'file_id' => 'sometimes|exists:data_files,id',
            'project_id' => 'sometimes|integer|exists:projects,id',
        ]);

        $query = GlobalChartTree::query();
        $this->scopeToUser($query, $request->user());
        if ($request->has('file_id')) {
            $query->where('file_id', $request->file_id);
        }
        if ($request->has('project_id')) {
            $query->where('project_id', $request->project_id);
        }

        $trees = $query->get()
            ->map(fn ($t) => [
                'id' => $t->id,
                'file_id' => $t->file_id,
                'project_id' => $t->project_id,
                'tree_name' => $t->tree_name,
                'structure' => $t->structure,
                'created_at' => $t->created_at,
            ]);

        return response()->json(['status' => 'success', 'data' => $trees]);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $tree = GlobalChartTree::with('dataFile:id,name,file_path')->findOrFail($id);

        if (! $this->treeAccessibleBy($tree, $request->user())) {
            return response()->json(['status' => 'error', 'message' => 'غير مصرح بالوصول إلى هذا التبويب'], 403);
        }

        $responseData = [
            'id' => $tree->id,
            'file_id' => $tree->file_id,
            'file_name' => $tree->dataFile->name,
            'tree_name' => $tree->tree_name,
            'structure' => $tree->structure,
        ];

        if ($request->boolean('include_chart_data')) {
            $structure = $tree->structure;
            $charts = isset($structure['charts']) ? $structure['charts'] : [];

            if (! empty($charts) && $tree->dataFile) {
                $cacheValid = $tree->chart_data_cached_at !== null
                    && $tree->updated_at !== null
                    && $tree->chart_data_cached_at >= $tree->updated_at;

                if ($cacheValid && $tree->chart_data !== null) {
                    $responseData['chart_data'] = $tree->chart_data;
                } else {
                    try {
                        $fileReader = app(FileReaderService::class);
                        $filePath = $tree->dataFile->file_path;
                        $sheet = $fileReader->getSheetName($filePath);
                        $chartConfigs = array_map(fn ($c) => [
                            'id' => $c['id'],
                            'x' => $c['x'],
                            'y' => $c['y'] ?? '',
                        ], $charts);
                        $result = $fileReader->batchChartData($filePath, $sheet, $chartConfigs);
                        $chartData = $result['charts'] ?? [];
                        $responseData['chart_data'] = $chartData;

                        $tree->chart_data = $chartData;
                        $tree->chart_data_cached_at = now();
                        $tree->save();
                    } catch (\Exception $e) {
                        $responseData['chart_data'] = new \stdClass();
                        $responseData['chart_data_error'] = $e->getMessage();
                    }
                }
            } else {
                $responseData['chart_data'] = new \stdClass();
            }
        }

        return response()->json([
            'status' => 'success',
            'data' => $responseData,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'file_id' => 'required|exists:data_files,id',
            'project_id' => 'sometimes|integer|exists:projects,id',
            'tree_name' => 'required|string|max:255',
            'structure' => 'required|array',
        ]);

        $user = $request->user();

        // The user must own the file they are building a tab on (admins exempt).
        $file = DataFile::findOrFail($validated['file_id']);
        $fileOwned = $user->role === 'admin'
            || $file->uploaded_by === $user->id
            || ($file->project_id !== null && Project::where('id', $file->project_id)->where('created_by', $user->id)->exists());
        if (! $fileOwned) {
            return response()->json(['status' => 'error', 'message' => 'غير مصرح باستخدام هذا الملف'], 403);
        }

        if ($request->has('project_id')) {
            $project = Project::find($validated['project_id']);
            if (! $project || ! $project->isAccessibleBy($user)) {
                return response()->json(['status' => 'error', 'message' => 'غير مصرح بالإضافة إلى هذا المشروع'], 403);
            }

            $fileBelongsToProject = $file->project_id === (int) $validated['project_id'];
            $fileHasNoProject = $file->project_id === null;

            if (!$fileBelongsToProject && !$fileHasNoProject) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'الملف المحدد لا ينتمي إلى هذا المشروع أو ليس ملفاً عاماً',
                ], 422);
            }
        }

        $tree = GlobalChartTree::create([
            'file_id' => $validated['file_id'],
            'project_id' => $request->input('project_id'),
            'tree_name' => $validated['tree_name'],
            'structure' => $validated['structure'],
        ]);

        return response()->json([
            'status' => 'success',
            'data' => [
                'id' => $tree->id,
                'tree_name' => $tree->tree_name,
                'structure' => $tree->structure,
            ],
        ], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $tree = GlobalChartTree::findOrFail($id);

        if (! $this->treeAccessibleBy($tree, $request->user())) {
            return response()->json(['status' => 'error', 'message' => 'غير مصرح بتعديل هذا التبويب'], 403);
        }

        $validated = $request->validate([
            'tree_name' => 'sometimes|string|max:255',
            'structure' => 'sometimes|array',
        ]);

        $tree->update($validated);

        $tree->chart_data = null;
        $tree->chart_data_cached_at = null;
        $tree->save();

        return response()->json([
            'status' => 'success',
            'data' => [
                'id' => $tree->id,
                'tree_name' => $tree->tree_name,
                'structure' => $tree->structure,
            ],
        ]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $tree = GlobalChartTree::findOrFail($id);

        if (! $this->treeAccessibleBy($tree, $request->user())) {
            return response()->json(['status' => 'error', 'message' => 'غير مصرح بحذف هذا التبويب'], 403);
        }

        $tree->delete();

        return response()->json(['status' => 'success']);
    }
}
