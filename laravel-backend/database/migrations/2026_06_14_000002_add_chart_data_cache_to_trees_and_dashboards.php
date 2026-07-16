<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('global_chart_trees', function (Blueprint $table) {
            $table->json('chart_data')->nullable()->after('structure');
            $table->timestamp('chart_data_cached_at')->nullable()->after('chart_data');
        });
    }

    public function down(): void
    {
        Schema::table('global_chart_trees', function (Blueprint $table) {
            $table->dropColumn(['chart_data', 'chart_data_cached_at']);
        });
    }
};