<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProjectController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Project::with('creator:id,full_name')
            ->withCount('dataFiles')
            ->accessibleBy($request->user());

        $projects = $query->get()->map(fn ($p) => [
            'id' => $p->id,
            'name' => $p->name,
            'description' => $p->description,
            'created_by' => $p->creator?->full_name,
            'data_files_count' => $p->data_files_count,
            'created_at' => $p->created_at,
        ]);

        return response()->json(['status' => 'success', 'data' => $projects]);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $project = Project::with('creator:id,full_name')
            ->withCount('dataFiles')
            ->findOrFail($id);

        if (! $project->isAccessibleBy($request->user())) {
            return response()->json(['status' => 'error', 'message' => 'غير مصرح بالوصول إلى هذا المشروع'], 403);
        }

        $files = $project->dataFiles()->with('uploader:id,full_name')->get()->map(fn ($f) => [
            'id' => $f->id,
            'name' => $f->name,
            'uploaded_by' => $f->uploader?->full_name,
            'created_at' => $f->created_at,
        ]);

        $tabs = $project->chartTrees()->get()->map(fn ($t) => [
            'id' => $t->id,
            'tree_name' => $t->tree_name,
            'file_id' => $t->file_id,
            'structure' => $t->structure,
            'created_at' => $t->created_at,
        ]);

        return response()->json([
            'status' => 'success',
            'data' => [
                'id' => $project->id,
                'name' => $project->name,
                'description' => $project->description,
                'created_by' => $project->creator?->full_name,
                'created_by_id' => $project->created_by,
                'data_files_count' => $project->data_files_count,
                'files' => $files,
                'tabs' => $tabs,
                'created_at' => $project->created_at,
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
        ]);

        $project = Project::create([
            'name' => $validated['name'],
            'description' => $validated['description'] ?? null,
            'created_by' => $request->user()->id,
        ]);

        return response()->json([
            'status' => 'success',
            'data' => [
                'id' => $project->id,
                'name' => $project->name,
                'description' => $project->description,
            ],
        ], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $project = Project::findOrFail($id);

        if (! $project->isAccessibleBy($request->user())) {
            return response()->json(['status' => 'error', 'message' => 'غير مصرح بتعديل هذا المشروع'], 403);
        }

        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'description' => 'nullable|string',
        ]);

        $project->update($validated);

        return response()->json([
            'status' => 'success',
            'data' => [
                'id' => $project->id,
                'name' => $project->name,
                'description' => $project->description,
            ],
        ]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $project = Project::findOrFail($id);

        if (! $project->isAccessibleBy($request->user())) {
            return response()->json(['status' => 'error', 'message' => 'غير مصرح بحذف هذا المشروع'], 403);
        }

        $project->delete();

        return response()->json(['status' => 'success']);
    }
}