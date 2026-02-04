import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext'; // Adjust path if needed

// Use your specific API URL
const API_URL = 'http://localhost:3001'; 

const AdminDashboard = () => {
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const { currentUser } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        // Security Check: Kick out non-admins
        if (currentUser && currentUser.userType !== 'admin') {
            alert("Access Denied: Admins Only");
            navigate('/');
            return;
        }

        fetchRequests();
    }, [currentUser, navigate]);

    const fetchRequests = async () => {
        try {
            const { data } = await axios.get(`${API_URL}/api/admin/verifications`);
            setRequests(data);
        } catch (error) {
            console.error("Failed to load requests");
        } finally {
            setLoading(false);
        }
    };

    const handleAction = async (userId, action) => {
        if (!window.confirm(`Are you sure you want to ${action} this user?`)) return;

        try {
            await axios.post(`${API_URL}/api/admin/verify-action`, { userId, action });
            
            // Remove the user from the list locally
            setRequests(requests.filter(req => req._id !== userId));
            alert(`User ${action}d successfully!`);
        } catch (error) {
            alert("Action failed.");
        }
    };

    if (loading) return <div className="p-8 text-white">Loading Admin Panel...</div>;

    return (
        <div className="min-h-screen bg-slate-900 p-8 text-white">
            <h1 className="text-3xl font-bold mb-8">🛡️ Admin Verification Dashboard</h1>

            {requests.length === 0 ? (
                <div className="text-slate-400 text-lg">No pending verifications. Good job! 🎉</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {requests.map(user => (
                        <div key={user._id} className="bg-slate-800 border border-slate-700 p-6 rounded-xl">
                            <div className="flex items-center gap-4 mb-4">
                                <div className="h-12 w-12 rounded-full bg-indigo-600 flex items-center justify-center text-xl font-bold">
                                    {user.username.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg">{user.username}</h3>
                                    <p className="text-sm text-slate-400">{user.email}</p>
                                    <span className="text-xs bg-orange-900 text-orange-200 px-2 py-1 rounded">Pending</span>
                                </div>
                            </div>

                            <div className="mb-4">
                                <p className="text-sm text-slate-400 mb-2">ID Proof Document:</p>
                                {user.verificationDocument ? (
                                    <img 
                                        src={user.verificationDocument} 
                                        alt="ID Proof" 
                                        className="w-full h-48 object-cover rounded-lg border border-slate-600 cursor-pointer hover:scale-105 transition"
                                        onClick={() => window.open(user.verificationDocument, '_blank')}
                                    />
                                ) : (
                                    <div className="h-48 bg-slate-700 flex items-center justify-center text-slate-500 rounded-lg">No Image</div>
                                )}
                            </div>

                            <div className="flex gap-3 mt-4">
                                <button 
                                    onClick={() => handleAction(user._id, 'approve')}
                                    className="flex-1 bg-green-600 hover:bg-green-500 py-2 rounded-lg font-bold"
                                >
                                    ✅ Approve
                                </button>
                                <button 
                                    onClick={() => handleAction(user._id, 'reject')}
                                    className="flex-1 bg-red-600 hover:bg-red-500 py-2 rounded-lg font-bold"
                                >
                                    ❌ Reject
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AdminDashboard;