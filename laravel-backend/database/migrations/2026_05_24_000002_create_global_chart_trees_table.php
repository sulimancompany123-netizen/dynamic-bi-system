<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('global_chart_trees', function (Blueprint $table) {
            $table->id();
            $table->foreignId('file_id')->constrained('data_files')->cascadeOnDelete();
            $table->string('tree_name');
            $table->longText('structure');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('global_chart_trees');
    }
};