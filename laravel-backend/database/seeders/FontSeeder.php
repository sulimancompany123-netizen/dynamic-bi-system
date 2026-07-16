<?php

namespace Database\Seeders;

use App\Models\Font;
use Illuminate\Database\Seeder;

class FontSeeder extends Seeder
{
    public function run(): void
    {
        Font::create(["name" => "Cairo", "font_family" => "Cairo, sans-serif", "category" => "sans-serif"]);
        Font::create(["name" => "Tajawal", "font_family" => "Tajawal, sans-serif", "category" => "sans-serif"]);
        Font::create(["name" => "Tahoma", "font_family" => "Tahoma, Geneva, sans-serif", "category" => "sans-serif"]);
        Font::create(["name" => "Arial", "font_family" => "Arial, Helvetica, sans-serif", "category" => "sans-serif"]);
    }
}