<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('global_chart_trees', function (Blueprint $table) {
            $table->foreignId('project_id')->nullable()->constrained('projects')->cascadeOnDelete()->after('file_id');
        });
    }

    public function down(): void
    {
        Schema::table('global_chart_trees', function (Blueprint $table) {
            $table->dropConstrainedForeignId('project_id');
        });
    }
};