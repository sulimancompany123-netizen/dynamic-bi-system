<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UserController extends Controller
{
    public function index(): JsonResponse
    {
        $users = User::select('id', 'username', 'full_name', 'role', 'created_at')
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json(['status' => 'success', 'data' => $users]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'username' => 'required|string|unique:users,username|max:191',
            'password' => 'required|string|min:6',
            'full_name' => 'required|string|max:255',
            'role' => 'required|in:admin,user',
        ]);

        $user = User::create([
            'username' => $validated['username'],
            'password' => bcrypt($validated['password']),
            'full_name' => $validated['full_name'],
            'role' => $validated['role'],
        ]);

        return response()->json([
            'status' => 'success',
            'user' => [
                'id' => $user->id,
                'username' => $user->username,
                'full_name' => $user->full_name,
                'role' => $user->role,
            ],
        ], 201);
    }

    public function destroy(string $id): JsonResponse
    {
        $user = User::findOrFail($id);
        if ($user->id === request()->user()->id) {
            return response()->json(['status' => 'error', 'detail' => 'لا يمكن حذف المستخدم نفسه'], 400);
        }
        $user->delete();
        return response()->json(['status' => 'success', 'message' => 'تم حذف المستخدم']);
    }
}