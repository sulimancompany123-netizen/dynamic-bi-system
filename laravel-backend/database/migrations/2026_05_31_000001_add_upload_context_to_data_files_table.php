<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('data_files', function (Blueprint $table) {
            $table->enum('upload_context', ['general', 'dashboard'])->default('general')->after('file_path');
        });
    }

    public function down(): void
    {
        Schema::table('data_files', function (Blueprint $table) {
            $table->dropColumn('upload_context');
        });
    }
};