<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Dashboard extends Model
{
    protected $fillable = [
        'project_id',
        'created_by',
        'name',
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

    public function project()
    {
        return $this->belongsTo(Project::class);
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * Users granted read-only view access to this dashboard.
     */
    public function viewers()
    {
        return $this->belongsToMany(User::class, 'dashboard_user');
    }

    /**
     * Whether the user may create/edit/delete this dashboard and manage its access:
     * an admin, or the owner of the project it belongs to.
     */
    public function manageableBy(?User $user): bool
    {
        if (! $user) {
            return false;
        }

        return $user->role === 'admin'
            || ($this->project && $this->project->created_by === $user->id);
    }

    /**
     * Whether the user may view this dashboard: anyone who can manage it, plus users
     * who have been granted explicit view access.
     */
    public function viewableBy(?User $user): bool
    {
        if (! $user) {
            return false;
        }

        if ($this->manageableBy($user)) {
            return true;
        }

        return $this->viewers()->where('user_id', $user->id)->exists();
    }
}
