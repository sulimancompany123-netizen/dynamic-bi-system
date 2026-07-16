<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DataFile extends Model
{
    protected $fillable = [
        'name',
        'file_path',
        'uploaded_by',
        'project_id',
        'upload_context',
        'columns_json',
        'preview_json',
        'total_rows',
        'total_columns',
    ];

    protected $casts = [
        'columns_json' => 'array',
        'preview_json' => 'array',
    ];

    public function uploader()
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    public function globalChartTrees()
    {
        return $this->hasMany(GlobalChartTree::class, 'file_id');
    }

    public function project()
    {
        return $this->belongsTo(Project::class);
    }
}