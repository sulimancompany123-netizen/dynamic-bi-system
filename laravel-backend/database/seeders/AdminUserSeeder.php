<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        User::create([
            'username' => 'admin',
            'password' => bcrypt('admin123'),
            'full_name' => 'مدير النظام',
            'role' => 'admin',
        ]);

        User::create([
            'username' => 'user',
            'password' => bcrypt('user123'),
            'full_name' => 'مستخدم تجريبي',
            'role' => 'user',
        ]);
    }
}