<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('file_data_rows');
    }

    public function down(): void
    {
        Schema::create('file_data_rows', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('file_id');
            $table->integer('row_index');
            $table->json('data');
            $table->timestamps();

            $table->foreign('file_id')->references('id')->on('data_files')->onDelete('cascade');
            $table->index('file_id');
        });
    }
};