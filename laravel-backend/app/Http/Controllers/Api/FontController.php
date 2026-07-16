<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Font;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FontController extends Controller
{
    public function index(): JsonResponse
    {
        $fonts = Font::orderBy("name")->get();

        return response()->json(["status" => "success", "data" => $fonts]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            "name" => "required|string|max:255",
            "font_family" => "required|string|max:255",
            "category" => "sometimes|string|max:255",
        ]);

        $font = Font::create($validated);

        return response()->json(["status" => "success", "data" => $font], 201);
    }

    public function destroy(int $id): JsonResponse
    {
        $font = Font::findOrFail($id);
        $font->delete();

        return response()->json(["status" => "success"]);
    }
}