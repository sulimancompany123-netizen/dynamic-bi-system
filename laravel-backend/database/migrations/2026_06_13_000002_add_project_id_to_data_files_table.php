<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('data_files', function (Blueprint $table) {
            $table->foreignId('project_id')->nullable()->constrained('projects')->nullOnDelete()->after('uploaded_by');
        });
    }

    public function down(): void
    {
        Schema::table('data_files', function (Blueprint $table) {
            $table->dropConstrainedForeignId('project_id');
        });
    }
};