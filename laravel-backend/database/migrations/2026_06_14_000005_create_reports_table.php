<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create("reports", function (Blueprint $table) {
            $table->id();
            $table->foreignId("user_id")->constrained()->cascadeOnDelete();
            // Nullable: templates are project-independent (project_id is null for templates).
            $table->foreignId("project_id")->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId("chart_tree_id")->nullable()->constrained("global_chart_trees")->nullOnDelete();
            $table->string("title");
            $table->longText("content");
            $table->json("config");
            $table->boolean("is_template")->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists("reports");
    }
};
