<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Report extends Model
{
    protected $fillable = [
        "user_id",
        "project_id",
        "chart_tree_id",
        "title",
        "content",
        "config",
        "is_template",
    ];

    protected function casts(): array
    {
        return [
            "content" => "array",
            "config" => "array",
            "is_template" => "boolean",
        ];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function project()
    {
        return $this->belongsTo(Project::class);
    }

    public function chartTree()
    {
        return $this->belongsTo(GlobalChartTree::class, "chart_tree_id");
    }
}
