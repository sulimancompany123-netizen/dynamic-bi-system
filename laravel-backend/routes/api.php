<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\DataFileController;
use App\Http\Controllers\Api\GlobalChartTreeController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\ProjectController;
use App\Http\Controllers\Api\FontController;
use App\Http\Controllers\Api\DashboardController;
use Illuminate\Support\Facades\Route;

// Public
Route::post('/login', [AuthController::class, 'login']);

// Authenticated
Route::middleware('auth:sanctum')->group(function () {

    // Data files (all authenticated users â€” scoped by role)
    Route::get('/data-files', [DataFileController::class, 'index']);
    Route::post('/data-files/upload', [DataFileController::class, 'upload']);
    Route::post('/data-files/{id}/replace', [DataFileController::class, 'replace']);

    Route::post('/table-data', [DataFileController::class, 'tableData']);
    Route::post('/chart-data', [DataFileController::class, 'chartData']);
    Route::post('/batch-chart-data', [DataFileController::class, 'batchChartData']);
    Route::get('/column-categories', [DataFileController::class, 'columnCategories']);
    Route::post('/sheet-columns', [DataFileController::class, 'sheetColumns']);
    Route::post('/select-sheet', [DataFileController::class, 'selectSheet']);
    Route::post('/concat-sheets', [DataFileController::class, 'concatSheets']);
    Route::post('/merge-multiple-sheets', [DataFileController::class, 'mergeMultipleSheets']);
    Route::post('/column-details', [DataFileController::class, 'columnDetails']);
    Route::post('/import-file-data', [DataFileController::class, 'importFileData']);

    // Global chart trees / tabs (scoped to projects the user owns; admin sees all)
    Route::get('/global-chart-trees', [GlobalChartTreeController::class, 'index']);
    Route::get('/global-chart-trees/{id}', [GlobalChartTreeController::class, 'show']);
    Route::post('/global-chart-trees', [GlobalChartTreeController::class, 'store']);
    Route::put('/global-chart-trees/{id}', [GlobalChartTreeController::class, 'update']);
    Route::delete('/global-chart-trees/{id}', [GlobalChartTreeController::class, 'destroy']);

    // Projects (each user owns their own; admin sees & edits all)
    Route::get('/projects', [ProjectController::class, 'index']);
    Route::get('/projects/{id}', [ProjectController::class, 'show']);
    Route::post('/projects', [ProjectController::class, 'store']);
    Route::put('/projects/{id}', [ProjectController::class, 'update']);
    Route::delete('/projects/{id}', [ProjectController::class, 'destroy']);

// Reports (scoped by role, admin can use ?all=1)
    Route::get('/reports', [ReportController::class, 'index']);
    Route::get('/reports/{id}', [ReportController::class, 'show']);
    Route::post('/reports', [ReportController::class, 'store']);
    Route::post('/reports/upload-image', [ReportController::class, 'uploadImage']);
    Route::post('/reports/image-data', [ReportController::class, 'imageData']);
    Route::put('/reports/{id}', [ReportController::class, 'update']);
    Route::delete('/reports/{id}', [ReportController::class, 'destroy']);

    // Dashboards (managed by admins + project owners; viewable by granted users).
    // NOTE: /dashboards/shared must precede /dashboards/{id} so "shared" isn't taken as an id.
    Route::get('/dashboards/shared', [DashboardController::class, 'shared']);
    Route::get('/dashboards', [DashboardController::class, 'index']);
    Route::post('/dashboards', [DashboardController::class, 'store']);
    Route::get('/dashboards/{id}', [DashboardController::class, 'show']);
    Route::put('/dashboards/{id}', [DashboardController::class, 'update']);
    Route::delete('/dashboards/{id}', [DashboardController::class, 'destroy']);
    Route::get('/dashboards/{id}/access', [DashboardController::class, 'accessIndex']);
    Route::post('/dashboards/{id}/access', [DashboardController::class, 'accessSync']);

    // Fonts (all authenticated users can read/add)
    Route::get('/fonts', [FontController::class, 'index']);
    Route::post('/fonts', [FontController::class, 'store']);
    Route::delete('/fonts/{id}', [FontController::class, 'destroy'])->middleware('admin');

    // Admin-only
    Route::middleware('admin')->group(function () {
        Route::get('/users', [UserController::class, 'index']);
        Route::post('/users', [UserController::class, 'store']);
        Route::delete('/users/{id}', [UserController::class, 'destroy']);
    });
});

