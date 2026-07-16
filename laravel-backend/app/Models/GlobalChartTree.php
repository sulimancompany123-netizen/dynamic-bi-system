<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class GlobalChartTree extends Model
{
    protected $fillable = [
        'file_id',
        'project_id',
        'tree_name',
        'structure',
        'chart_data',
        'chart_data_cached_at',
    ];

    protected function casts(): array
    {
        return [
            'structure' => 'array',
            'chart_data' => 'array',
            'chart_data_cached_at' => 'datetime',
        ];
    }

    public function dataFile()
    {
        return $this->belongsTo(DataFile::class, 'file_id');
    }

    public function project()
    {
        return $this->belongsTo(Project::class);
    }
}