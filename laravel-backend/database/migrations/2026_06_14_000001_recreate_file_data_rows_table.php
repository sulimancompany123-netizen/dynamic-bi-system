<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('file_data_rows', function (Blueprint $table) {
            $table->id();
            $table->foreignId('file_id')->constrained('data_files')->cascadeOnDelete();
            $table->unsignedInteger('row_index');
            $table->json('data');
            $table->timestamps();

            $table->index(['file_id', 'row_index']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('file_data_rows');
    }
};