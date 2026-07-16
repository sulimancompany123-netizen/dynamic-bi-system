import React, { useState } from 'react';
import { BarChart3, Lock, User, LogIn } from 'lucide-react';

const API_BASE = 'http://127.0.0.1:8000';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (data.status === 'success') {
        onLogin(data.token, data.user);
      } else {
        setError(data.errors?.username?.[0] || 'بيانات الدخول غير صحيحة');
      }
    } catch {
      setError('فشل الاتصال بالخادم');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-10 w-full max-w-md">
        <div className="text-center mb-8">
          <BarChart3 className="w-14 h-14 text-[#054239] mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-[#002623]">منظومة BI الذكية</h1>
          <p className="text-sm text-gray-500 mt-1">للتنقيب الهرمي وتحليل البيانات</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1.5">
              <User className="w-4 h-4 inline ml-1" /> اسم المستخدم
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#428177]"
              placeholder="أدخل اسم المستخدم"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1.5">
              <Lock className="w-4 h-4 inline ml-1" /> كلمة المرور
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#428177]"
              placeholder="أدخل كلمة المرور"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg border border-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-[#054239] hover:bg-[#002623] disabled:bg-gray-300 text-white py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            {submitting ? 'جاري تسجيل الدخول...' : 'دخول'}
          </button>
        </form>

        <div className="mt-6 p-4 bg-gray-50 rounded-xl text-xs text-gray-500">
          <p className="font-bold text-gray-700 mb-1">بيانات تسجيل الدخول التجريبية:</p>
          <p>المشرف: <span className="font-mono text-[#054239]">admin</span> / <span className="font-mono text-[#054239]">admin123</span></p>
          <p>المستخدم: <span className="font-mono text-[#054239]">user</span> / <span className="font-mono text-[#054239]">user123</span></p>
        </div>
      </div>
    </div>
  );
}