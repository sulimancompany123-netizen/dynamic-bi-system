<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('data_files', function (Blueprint $table) {
            $table->json('columns_json')->nullable()->after('upload_context');
            $table->json('preview_json')->nullable()->after('columns_json');
            $table->unsignedBigInteger('total_rows')->nullable()->after('preview_json');
            $table->unsignedBigInteger('total_columns')->nullable()->after('total_rows');
        });
    }

    public function down(): void
    {
        Schema::table('data_files', function (Blueprint $table) {
            $table->dropColumn(['columns_json', 'preview_json', 'total_rows', 'total_columns']);
        });
    }
};