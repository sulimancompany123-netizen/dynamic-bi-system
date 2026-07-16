import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Trash2, Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '../api';

export default function UserManagement({ onBack }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    username: '',
    password: '',
    full_name: '',
    role: 'user',
  });

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet('/api/users');
      if (res.status === 'success') {
        setUsers(res.data);
      } else {
        setError('فشل تحميل قائمة المستخدمين');
      }
    } catch (err) {
      setError('فشل الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiPost('/api/users', formData);
      if (res.status === 'success') {
        setUsers([res.user, ...users]);
        setShowForm(false);
        setFormData({ username: '', password: '', full_name: '', role: 'user' });
      } else {
        setError(res.detail || 'فشل إنشاء المستخدم');
      }
    } catch (err) {
      setError('فشل الاتصال بالخادم');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا المستخدم؟')) return;
    try {
      const res = await apiDelete(`/api/users/${userId}`);
      if (res.status === 'success') {
        setUsers(users.filter((u) => u.id !== userId));
      } else {
        alert(res.detail || 'فشل حذف المستخدم');
      }
    } catch (err) {
      alert('فشل الاتصال بالخادم');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-[#054239] transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-[#002623]">إدارة المستخدمين</h2>
            <p className="text-sm text-gray-500 mt-1">إضافة وحذف المستخدمين</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-[#054239] hover:bg-[#002623] text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm"
        >
          <UserPlus className="w-4 h-4" /> {showForm ? 'إلغاء' : 'إضافة مستخدم'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreateUser} className="bg-white border border-gray-200 rounded-xl p-6 mb-6 shadow-sm">
          <h3 className="font-bold text-[#002623] mb-4">مستخدم جديد</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5">اسم المستخدم</label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#428177]"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5">كلمة المرور</label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#428177]"
                required
                minLength={6}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5">الاسم الكامل</label>
              <input
                type="text"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#428177]"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5">الصلاحية</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#428177]"
              >
                <option value="user">مستخدم</option>
                <option value="admin">مسؤول</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="mt-4 bg-[#054239] hover:bg-[#002623] disabled:bg-gray-300 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-all"
          >
            {submitting ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-[#428177]" />
        </div>
      ) : users.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center">
          <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-500">لا يوجد مستخدمون</h3>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-right text-sm">
            <thead className="bg-[#054239] text-white text-xs">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">اسم المستخدم</th>
                <th className="p-3">الاسم الكامل</th>
                <th className="p-3">الصلاحية</th>
                <th className="p-3">تاريخ الإنشاء</th>
                <th className="p-3">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y text-gray-600">
              {users.map((user, idx) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="p-3 font-bold text-gray-400">{idx + 1}</td>
                  <td className="p-3">{user.username}</td>
                  <td className="p-3">{user.full_name}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {user.role === 'admin' ? 'مسؤول' : 'مستخدم'}
                    </span>
                  </td>
                  <td className="p-3 text-gray-400 text-xs">{user.created_at ? new Date(user.created_at).toLocaleDateString('ar-SA') : ''}</td>
                  <td className="p-3">
                    <button
                      onClick={() => handleDeleteUser(user.id)}
                      className="text-red-400 hover:text-red-600 transition-colors"
                      title="حذف"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}