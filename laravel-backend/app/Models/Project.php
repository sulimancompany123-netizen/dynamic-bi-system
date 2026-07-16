<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Project extends Model
{
    protected $fillable = [
        'name',
        'description',
        'created_by',
    ];

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function dataFiles()
    {
        return $this->hasMany(DataFile::class);
    }

    public function chartTrees()
    {
        return $this->hasMany(GlobalChartTree::class);
    }

    /**
     * Whether the given user may view/modify this project and everything inside it
     * (files, tabs, dashboards, reports). Admins may access any project; everyone
     * else may only access the projects they created.
     */
    public function isAccessibleBy(?User $user): bool
    {
        if (! $user) {
            return false;
        }

        return $user->role === 'admin' || $this->created_by === $user->id;
    }

    /**
     * Restrict a query to the projects the given user is allowed to see.
     * Admins see everything; everyone else sees only their own projects.
     */
    public function scopeAccessibleBy($query, User $user)
    {
        if ($user->role !== 'admin') {
            $query->where('created_by', $user->id);
        }

        return $query;
    }
}
