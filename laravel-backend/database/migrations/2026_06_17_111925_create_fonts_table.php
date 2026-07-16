<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create("fonts", function (Blueprint $table) {
            $table->id();
            $table->string("name");
            $table->string("font_family");
            $table->string("category")->default("sans-serif");
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists("fonts");
    }
};