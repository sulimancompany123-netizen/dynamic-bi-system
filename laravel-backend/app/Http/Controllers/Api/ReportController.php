<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\Report;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class ReportController extends Controller
{
    /**
     * Whether the user may read/modify a report: the report's author, the owner of
     * the project it belongs to, or an admin.
     */
    protected function reportAccessibleBy(Report $report, $user): bool
    {
        if ($user->role === 'admin' || $report->user_id === $user->id) {
            return true;
        }

        return $report->project_id !== null
            && Project::where('id', $report->project_id)->where('created_by', $user->id)->exists();
    }

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = Report::with("user:id,full_name");

        if ($request->boolean("templates")) {
            // Templates are project-independent. Each user sees their own; admins see all.
            $query->where("is_template", true);
            if ($user->role !== "admin") {
                $query->where("user_id", $user->id);
            }
        } else {
            // Regular (non-template) reports only.
            $query->where("is_template", false);

            if ($request->has("project_id")) {
                $project = Project::find($request->project_id);
                if (! $project || ! $project->isAccessibleBy($user)) {
                    return response()->json(["status" => "error", "message" => "غير مصرح بالوصول إلى تقارير هذا المشروع"], 403);
                }
                $query->where("project_id", $request->project_id);
            } elseif ($user->role !== "admin") {
                // Reports the user authored, plus every report inside projects they own.
                $query->where(function ($q) use ($user) {
                    $q->where("user_id", $user->id)
                        ->orWhereHas("project", fn ($p) => $p->where("created_by", $user->id));
                });
            } elseif (! $request->boolean("all")) {
                $query->where("user_id", $user->id);
            }
        }

        $reports = $query->get()->map(fn ($r) => [
            "id" => $r->id,
            "user_id" => $r->user_id,
            "user_name" => $r->user?->full_name,
            "project_id" => $r->project_id,
            "chart_tree_id" => $r->chart_tree_id,
            "title" => $r->title,
            "is_template" => $r->is_template,
            "created_at" => $r->created_at,
            "updated_at" => $r->updated_at,
        ]);

        return response()->json(["status" => "success", "data" => $reports]);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $report = Report::findOrFail($id);

        if (! $this->reportAccessibleBy($report, $request->user())) {
            return response()->json(["status" => "error", "message" => "Unauthorized"], 403);
        }

        return response()->json([
            "status" => "success",
            "data" => [
                "id" => $report->id,
                "user_id" => $report->user_id,
                "project_id" => $report->project_id,
                "chart_tree_id" => $report->chart_tree_id,
                "title" => $report->title,
                "content" => $report->content,
                "config" => $report->config,
                "is_template" => $report->is_template,
                "created_at" => $report->created_at,
                "updated_at" => $report->updated_at,
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            "project_id" => "nullable|integer|exists:projects,id",
            "chart_tree_id" => "sometimes|integer|exists:global_chart_trees,id",
            "title" => "required|string|max:255",
            "content" => "sometimes|array",
            "config" => "sometimes|array",
            "is_template" => "sometimes|boolean",
            "from_template_id" => "sometimes|integer|exists:reports,id",
        ]);

        $user = $request->user();
        $isTemplate = $validated["is_template"] ?? false;

        // Templates are project-independent; normal reports must belong to an accessible project.
        $projectId = null;
        if (! $isTemplate) {
            if (empty($validated["project_id"])) {
                return response()->json(["status" => "error", "message" => "يجب اختيار مشروع للتقرير"], 422);
            }
            $project = Project::find($validated["project_id"]);
            if (! $project || ! $project->isAccessibleBy($user)) {
                return response()->json(["status" => "error", "message" => "غير مصرح بإضافة تقرير إلى هذا المشروع"], 403);
            }
            $projectId = $project->id;
        }

        $content = $validated["content"] ?? [];
        $config = $validated["config"] ?? [];

        // Start a new report from a template: copy the template's content (access-checked).
        if (! empty($validated["from_template_id"])) {
            $template = Report::where("id", $validated["from_template_id"])->where("is_template", true)->first();
            if ($template && $this->reportAccessibleBy($template, $user)) {
                $content = $template->content ?? [];
                $config = $template->config ?? [];
            }
        }

        $report = Report::create([
            "user_id" => $user->id,
            "project_id" => $projectId,
            "chart_tree_id" => $validated["chart_tree_id"] ?? null,
            "title" => $validated["title"],
            "content" => $content,
            "config" => $config,
            "is_template" => $isTemplate,
        ]);

        return response()->json([
            "status" => "success",
            "data" => [
                "id" => $report->id,
                "title" => $report->title,
                "project_id" => $report->project_id,
                "chart_tree_id" => $report->chart_tree_id,
                "is_template" => $report->is_template,
            ],
        ], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $report = Report::findOrFail($id);

        if (! $this->reportAccessibleBy($report, $request->user())) {
            return response()->json(["status" => "error", "message" => "Unauthorized"], 403);
        }

        $validated = $request->validate([
            "title" => "sometimes|string|max:255",
            "content" => "sometimes|array",
            "config" => "sometimes|array",
            "chart_tree_id" => "sometimes|integer|exists:global_chart_trees,id",
            "is_template" => "sometimes|boolean",
        ]);

        $report->update($validated);

        return response()->json([
            "status" => "success",
            "data" => [
                "id" => $report->id,
                "title" => $report->title,
                "content" => $report->content,
                "config" => $report->config,
                "is_template" => $report->is_template,
            ],
        ]);
}

    public function destroy(Request $request, int $id): JsonResponse
    {
        $report = Report::findOrFail($id);

        if (! $this->reportAccessibleBy($report, $request->user())) {
            return response()->json(["status" => "error", "message" => "Unauthorized"], 403);
        }

        $report->delete();

        return response()->json(["status" => "success", "message" => "Report deleted."]);
    }

    public function uploadImage(Request $request): JsonResponse
    {
        // NOTE: can't use the `image` rule here — it relies on getimagesize(), which doesn't
        // recognize SVG, so it would reject every SVG before the mimes list is checked. Instead we
        // whitelist the extensions (mimes) AND the content-sniffed MIME types (mimetypes), which
        // together validate both the extension and the actual file contents.
        $request->validate([
            "file" => "required|file|max:5120|mimes:jpeg,png,gif,webp,svg|mimetypes:image/jpeg,image/png,image/gif,image/webp,image/svg+xml",
        ]);

        $path = $request->file("file")->store("report-images", "public");

        return response()->json([
            "status" => "success",
            "data" => [
                "url" => Storage::disk("public")->url($path),
            ],
        ]);
    }

    /**
     * Return a stored report image as a base64 data URL. The PDF export needs the
     * background image inline so it can be drawn onto every page; fetching it through
     * the (CORS-enabled) API avoids tainting the export canvas with a cross-origin
     * <img>, which would otherwise block html2canvas/jsPDF.
     */
    public function imageData(Request $request): JsonResponse
    {
        $request->validate(["url" => "required|string"]);

        $url = $request->input("url");
        $marker = "/storage/";
        $pos = strpos($url, $marker);
        if ($pos === false) {
            return response()->json(["status" => "error", "message" => "رابط صورة غير صالح"], 422);
        }

        $relative = ltrim(urldecode(substr($url, $pos + strlen($marker))), "/");

        // Reject path traversal and only serve from the public disk.
        if (str_contains($relative, "..") || ! Storage::disk("public")->exists($relative)) {
            return response()->json(["status" => "error", "message" => "الصورة غير موجودة"], 404);
        }

        $contents = Storage::disk("public")->get($relative);
        $mime = Storage::disk("public")->mimeType($relative) ?: "image/png";
        $dataUrl = "data:" . $mime . ";base64," . base64_encode($contents);

        return response()->json([
            "status" => "success",
            "data" => ["dataUrl" => $dataUrl],
        ]);
    }
}
