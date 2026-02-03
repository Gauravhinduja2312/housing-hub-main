import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate, useParams, Outlet, useLocation } from 'react-router-dom';
import { LogIn, UserPlus, Building, PlusCircle, Home, MapPin, Search, Edit, Trash2, MessageSquare, Heart, LayoutDashboard, Bell, ArrowLeft, Bed, Bath, Send, Star, User, ShieldCheck, UploadCloud, AlertTriangle, SlidersHorizontal, Sparkles, Video, Brain, Compass, List } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadialBarChart, RadialBar } from 'recharts';
import toast, { Toaster } from 'react-hot-toast';
import axios from 'axios';

// --- API & WEBSOCKET CONFIGURATION ---
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
export const WEBSOCKET_URL = API_URL.replace(/^http/, 'ws');
const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers['Authorization'] = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => 
    {
    if (error.response && error.response.status === 401) {
      console.error("Token rejected by backend:", error.response.data);
      

      localStorage.removeItem('token');
      localStorage.removeItem('currentUser');
      
      // COMMENT THIS OUT TEMPORARILY:
      // window.location.href = '/login';  <-- Disable this!
    }
    return Promise.reject(error);
  }
);

// --- CONTEXTS ---
const AuthContext = createContext();
const SearchContext = createContext();
const NotificationContext = createContext();
const WebSocketContext = createContext(null);
const FilterContext = createContext();


export const AuthProvider = ({ children }) => {
    const [currentUser, setCurrentUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // 1. Startup Logic: Checks for existing session
    useEffect(() => {
        const initializeAuth = () => {
            try {
                const storedUser = localStorage.getItem("currentUser");
                const token = localStorage.getItem("token");

                // Check if BOTH the user object and token exist
                if (storedUser && token) {
                    setCurrentUser(JSON.parse(storedUser));
                } else {
                    // If either is missing, clean up to prevent errors
                    localStorage.removeItem("token");
                    localStorage.removeItem("currentUser");
                    setCurrentUser(null);
                }
            } catch (error) {
                console.error("Auth initialization failed:", error);
                localStorage.clear();
                setCurrentUser(null);
            } finally {
                setLoading(false);
            }
        };

        initializeAuth();
    }, []);

    // 2. Login Helper: Call this from your Login Page!
    // This ensures data is saved consistently every time.
    const login = (user, token) => {
        localStorage.setItem("token", token);
        localStorage.setItem("currentUser", JSON.stringify(user));
        setCurrentUser(user);
    };

    // 3. Logout Helper
    const logout = useCallback(() => {
        localStorage.removeItem("token");
        localStorage.removeItem("currentUser");
        setCurrentUser(null);
    }, []);

    return (
        <AuthContext.Provider value={{ currentUser, login, logout, loading, setCurrentUser }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const SearchProvider = ({ children }) => {
    const [searchTerm, setSearchTerm] = useState('');
    return (
        <SearchContext.Provider value={{ searchTerm, setSearchTerm }}>
            {children}
        </SearchContext.Provider>
    );
};

export const WebSocketProvider = ({ children }) => {
    const { currentUser } = useContext(AuthContext);
    const ws = useRef(null);
    const [lastMessage, setLastMessage] = useState(null);

    useEffect(() => {
        if (currentUser && !ws.current) {
            ws.current = new WebSocket(WEBSOCKET_URL);
            ws.current.onopen = () => {
                const token = localStorage.getItem("token");
                ws.current.send(JSON.stringify({ type: 'auth', token }));
            };
            ws.current.onmessage = (event) => {
                setLastMessage(event.data);
            };
            ws.current.onclose = () => {
                ws.current = null;
            };
            return () => {
                if (ws.current) {
                    ws.current.close();
                    ws.current = null;
                }
            };
        } else if (!currentUser && ws.current) {
            ws.current.close();
            ws.current = null;
        }
    }, [currentUser]);

    const sendMessage = useCallback((message) => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(message);
        }
    }, []);

    return (
        <WebSocketContext.Provider value={{ lastMessage, sendMessage }}>
            {children}
        </WebSocketContext.Provider>
    );
};

export const NotificationProvider = ({ children }) => {
    const { currentUser } = useContext(AuthContext);
    const { lastMessage } = useContext(WebSocketContext);
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => {
        if (currentUser) {
            const fetchNotifications = async () => {
                try {
                    const { data } = await api.get('/api/notifications');
                    setNotifications(data);
                    setUnreadCount(data.filter(n => !n.isRead).length);
                } catch (error) {
                    console.error("Failed to fetch notifications");
                }
            };
            fetchNotifications();
        }
    }, [currentUser]);

    useEffect(() => {
        if (lastMessage) {
            const data = JSON.parse(lastMessage);
            if (data.type === 'newNotification') {
                toast.success('You have a new notification!');
                setNotifications(prev => [data.payload, ...prev]);
                setUnreadCount(prev => prev + 1);
            } else if (data.type === 'newMessage' && !window.location.pathname.includes('/messages/')) {
                toast.success('You have a new message!');
            }
        }
    }, [lastMessage]);

    const markAllAsRead = async () => {
        try {
            await api.put('/api/notifications/mark-read');
            setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
            setUnreadCount(0);
        } catch (error) {
            toast.error("Could not mark notifications as read.");
        }
    };

    return (
        <NotificationContext.Provider value={{ notifications, unreadCount, markAllAsRead }}>
            {children}
        </NotificationContext.Provider>
    );
};

export const FilterProvider = ({ children }) => {
    const [filters, setFilters] = useState({
        city: 'All',
        minPrice: '0',
        maxPrice: '100000',
        bedrooms: 'Any',
        propertyType: 'All',
        lat: null,
        lng: null,
    });

    const resetFilters = () => {
        setFilters({
            city: 'All',
            minPrice: '0',
            maxPrice: '100000',
            bedrooms: 'Any',
            propertyType: 'All',
            lat: null,
            lng: null,
        });
    };

    return (
        <FilterContext.Provider value={{ filters, setFilters, resetFilters }}>
            {children}
        </FilterContext.Provider>
    );
};


export const useAuth = () => useContext(AuthContext);
export const useSearch = () => useContext(SearchContext);
export const useNotifications = () => useContext(NotificationContext);
export const useWebSocket = () => useContext(WebSocketContext);
export const useFilters = () => useContext(FilterContext);

// --- DASHBOARD LAYOUT & COMPONENTS ---
const DashboardLayout = () => {
    const { currentUser, loading } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (!loading && !currentUser) {
            navigate('/login');
        }
    }, [currentUser, loading, navigate]);

    if (loading || !currentUser) {
        return <div className="h-screen w-full flex items-center justify-center bg-slate-900 text-white">Loading...</div>;
    }

    return (
        <NotificationProvider>
            <div className="flex h-screen bg-slate-900 text-slate-100 font-sans">
                <Sidebar />
                <div className="flex-1 flex flex-col overflow-hidden">
                    <Header />
                    <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-900 p-8">
                        <Outlet />
                    </main>
                </div>
            </div>
        </NotificationProvider>
    );
};

const Sidebar = () => {
    const location = useLocation();
    const { currentUser, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };
    
    const navItems = [
        { icon: LayoutDashboard, label: "Dashboard", path: "/" },
        { icon: Building, label: "All Properties", path: "/properties" },
        { icon: MessageSquare, label: "Messages", path: "/messages" },
        currentUser.userType === 'landlord' 
            ? { icon: List, label: "My Properties", path: "/my-properties" }
            : { icon: Heart, label: "My Favorites", path: "/favorites" },
        { icon: User, label: "Profile", path: "/profile"},
    ];

    return (
        <aside className="w-64 bg-slate-900 p-6 flex flex-col border-r border-slate-800">
            <div className="flex items-center space-x-2 mb-10">
                <Building className="h-8 w-8 text-indigo-400" />
                <span className="text-white text-2xl font-bold">Housing Hub</span>
            </div>
            <nav className="flex-1">
                <ul>
                    {navItems.map(item => {
                        const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
                        return (
                            <li key={item.label}>
                                <Link to={item.path} className={`flex items-center gap-3 px-4 py-3 my-2 rounded-lg transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                                    <item.icon size={20} />
                                    <span>{item.label}</span>
                                </Link>
                            </li>
                        )
                    })}
                </ul>
            </nav>
            <div className="mt-auto">
                {currentUser && (
                    <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg mb-4">
                        <img className="h-10 w-10 rounded-full object-cover" src={currentUser.profilePictureUrl || `https://placehold.co/100x100/1e293b/a78bfa?text=${(currentUser.username || 'U').charAt(0).toUpperCase()}`} alt="User Avatar" />
                        <div>
                            <p className="font-semibold text-white truncate">{currentUser.username || currentUser.email}</p>
                            <p className="text-sm text-slate-400 capitalize">{currentUser.userType}</p>
                        </div>
                    </div>
                )}
                 <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 text-slate-400 hover:bg-red-900/50 hover:text-white py-2 rounded-lg transition-colors">
                    <LogIn size={16} />
                    <span>Logout</span>
                </button>
            </div>
        </aside>
    );
};

const Header = () => {
    const { searchTerm, setSearchTerm } = useSearch();
    const { notifications, unreadCount, markAllAsRead } = useNotifications();
    const [showNotifications, setShowNotifications] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    
    const handleSearchChange = (e) => {
        setSearchTerm(e.target.value);
        if(location.pathname !== '/properties') {
            navigate('/properties');
        }
    };

    const getTitle = () => {
        if (location.pathname.startsWith('/profile')) return 'My Profile';
        if (location.pathname.startsWith('/properties/')) return 'Property Details';
        if (location.pathname.startsWith('/edit-property/')) return 'Edit Property';
        if (location.pathname.startsWith('/messages')) return 'Your Messages';
        if (location.pathname.startsWith('/my-properties')) return 'My Properties';
        if (location.pathname.startsWith('/favorites')) return 'My Favorites';
        switch (location.pathname) {
            case '/': return 'Dashboard';
            case '/properties': return 'All Properties';
            case '/add-property': return 'Add New Property';
            default: return 'Housing Hub';
        }
    };

    return (
        <header className="bg-slate-900/80 backdrop-blur-md p-4 flex justify-between items-center border-b border-slate-800 flex-shrink-0">
            <div><h1 className="text-2xl font-bold text-white">{getTitle()}</h1></div>
            <div className="flex items-center gap-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input type="text" placeholder="Search..." value={searchTerm} onChange={handleSearchChange} className="bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white" />
                </div>
                <div className="relative">
                    <button onClick={() => setShowNotifications(prev => !prev)} className="p-2 bg-slate-800 rounded-lg border border-slate-700 hover:bg-slate-700">
                        <Bell size={20} className="text-slate-300" />
                        {unreadCount > 0 && <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">{unreadCount}</span>}
                    </button>
                    {showNotifications && (
                        <div className="absolute right-0 mt-2 w-80 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-10">
                            <div className="p-3 flex justify-between items-center border-b border-slate-700">
                                <h3 className="font-semibold text-white">Notifications</h3>
                                <button onClick={markAllAsRead} className="text-sm text-indigo-400 hover:underline">Mark all as read</button>
                            </div>
                            <div className="max-h-96 overflow-y-auto">
                                {notifications.length > 0 ? notifications.map(n => (
                                    <Link to={n.link} key={n._id} onClick={() => setShowNotifications(false)} className={`block p-3 hover:bg-slate-700 ${!n.isRead ? 'bg-indigo-900/30' : ''}`}>
                                        <p className="text-sm text-white">{n.message}</p>
                                        <p className="text-xs text-slate-400 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                                    </Link>
                                )) : <p className="p-4 text-sm text-slate-400">No notifications yet.</p>}
                            </div>
                        </div>
                    )}
                </div>
                {useAuth().currentUser?.userType === 'landlord' && (
                    <Link to="/add-property" className="bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg flex items-center gap-2">
                        <PlusCircle size={20} /><span>New Property</span>
                    </Link>
                )}
            </div>
        </header>
    );
};

const StarRating = ({ rating }) => {
    return (
        <div className="flex items-center">
            {[...Array(5)].map((_, i) => (
                <Star 
                    key={i} 
                    size={16} 
                    className={i < rating ? "text-amber-400 fill-amber-400" : "text-slate-600"} 
                />
            ))}
        </div>
    );
};

const PropertyCard = ({ property, isFavorite, onToggleFavorite, onEdit, onDelete }) => {
    const { currentUser } = useAuth();
    return (
        <div className="bg-slate-800/50 rounded-2xl shadow-lg border border-slate-700 overflow-hidden group flex flex-col">
            <Link to={`/properties/${property._id}`} className="block">
                <div className="overflow-hidden h-48 relative">
                    <img src={property.image_url || 'https://placehold.co/400x300/1e293b/94a3b8?text=No+Image'} alt={property.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"/>
                    {property.averageRating > 0 && (
                        <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 text-sm text-white flex items-center gap-1">
                            <Star size={14} className="text-amber-400 fill-amber-400" />
                            {property.averageRating.toFixed(1)} ({property.reviewCount})
                        </div>
                    )}
                </div>
            </Link>
            <div className="p-5 flex flex-col flex-1">
                <h3 className="text-lg font-bold text-white mb-2 truncate">{property.title}</h3>
                <p className="text-slate-400 text-sm mb-4 flex items-center gap-2 flex-grow"><MapPin size={16} />{property.address}, {property.city}</p>
                <div className="flex justify-between items-center mt-auto">
                    <p className="text-indigo-400 text-xl font-bold">₹{property.price.toLocaleString()}<span className="text-xs text-slate-400 font-normal">/mo</span></p>
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1 text-sm text-slate-300"><Bed size={16}/> {property.bedrooms}</span>
                        <span className="flex items-center gap-1 text-sm text-slate-300"><Bath size={16}/> {property.bathrooms}</span>
                        {currentUser.userType === 'student' && onToggleFavorite && (
                             <button onClick={(e) => { e.stopPropagation(); onToggleFavorite(property._id); }} className={`p-2 rounded-md transition-colors ${isFavorite ? 'bg-pink-600 text-white' : 'bg-slate-700 hover:bg-pink-600/50'}`}>
                                <Heart size={16} />
                            </button>
                        )}
                        {currentUser.userType === 'landlord' && currentUser.uid === property.landlord_id && onEdit && onDelete && (
                            <div className="flex items-center gap-2">
                                <button onClick={() => onEdit(property._id)} className="p-2 bg-slate-700 rounded-md hover:bg-indigo-600 transition-colors"><Edit size={16} /></button>
                                <button onClick={() => onDelete(property._id)} className="p-2 bg-slate-700 rounded-md hover:bg-red-600 transition-colors"><Trash2 size={16} /></button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};


const Filters = () => {
    const { filters, setFilters, resetFilters } = useFilters();
    const [cities, setCities] = useState([]);
    const [showFilters, setShowFilters] = useState(false);
    const [geoLoading, setGeoLoading] = useState(false);

    useEffect(() => {
        const fetchCities = async () => {
            try {
                const { data } = await api.get('/api/properties/cities');
                setCities(['All', ...data]);
            } catch (error) {
                console.error("Could not fetch cities");
            }
        };
        fetchCities();
    }, []);

    const handleFilterChange = (e) => {
        setFilters(prev => ({ ...prev, [e.target.name]: e.target.value, lat: null, lng: null })); // Clear geo-filter
    };
    
    const handleButtonClick = (name, value) => {
        setFilters(prev => ({ ...prev, [name]: value, lat: null, lng: null })); // Clear geo-filter
    };

    const handleNearMe = () => {
        if (!navigator.geolocation) {
            toast.error("Geolocation is not supported by your browser.");
            return;
        }
        setGeoLoading(true);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                resetFilters(); // Reset other filters
                setFilters(prev => ({
                    ...prev,
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                }));
                setGeoLoading(false);
                toast.success("Searching for properties near you!");
            },
            () => {
                toast.error("Unable to retrieve your location.");
                setGeoLoading(false);
            }
        );
    };

    return (
        <div className="mb-8">
            <div className="flex flex-wrap gap-4">
                <button 
                    onClick={() => setShowFilters(!showFilters)} 
                    className="flex items-center gap-2 text-white bg-slate-800/50 px-4 py-2 rounded-lg border border-slate-700 hover:bg-slate-700"
                >
                    <SlidersHorizontal size={20} />
                    <span>{showFilters ? 'Hide' : 'Show'} Filters</span>
                </button>
                <button
                    onClick={handleNearMe}
                    disabled={geoLoading}
                    className="flex items-center gap-2 text-white bg-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-500 disabled:bg-indigo-800"
                >
                    <Compass size={20} />
                    <span>{geoLoading ? "Finding..." : "Find Near Me"}</span>
                </button>
                {filters.lat && (
                    <div className="flex items-center gap-2 text-green-400 bg-green-900/50 px-4 py-2 rounded-lg">
                        <span>Active: Near Me</span>
                        <button onClick={resetFilters} className="text-slate-400 hover:text-white">&times;</button>
                    </div>
                )}
            </div>
            
            {showFilters && (
                 <div className="mt-4 p-6 bg-slate-800/50 rounded-2xl border border-slate-700 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">City</label>
                        <select name="city" value={filters.city} onChange={handleFilterChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5">
                            {cities.map(city => <option key={city} value={city}>{city}</option>)}
                        </select>
                    </div>
                    <div className="lg:col-span-2">
                        <label className="block text-sm font-medium text-slate-300 mb-1">Price Range (₹{parseInt(filters.minPrice).toLocaleString()} - ₹{parseInt(filters.maxPrice).toLocaleString()})</label>
                        <div className="flex items-center gap-4">
                            <input type="range" name="minPrice" min="0" max="50000" step="1000" value={filters.minPrice} onChange={handleFilterChange} className="w-1/2"/>
                            <input type="range" name="maxPrice" min="50000" max="100000" step="1000" value={filters.maxPrice} onChange={handleFilterChange} className="w-1/2"/>
                        </div>
                    </div>
                    <div className="flex items-end">
                        <button onClick={resetFilters} className="w-full bg-slate-600 text-white font-bold py-2.5 rounded-lg hover:bg-slate-500">Reset Filters</button>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Bedrooms</label>
                        <div className="flex flex-wrap gap-2">
                            {['Any', '1', '2', '3', '4+'].map(val => (
                                <button key={val} onClick={() => handleButtonClick('bedrooms', val)} className={`px-3 py-1 rounded-full text-sm ${filters.bedrooms === val ? 'bg-indigo-600' : 'bg-slate-700 hover:bg-slate-600'}`}>{val}</button>
                            ))}
                        </div>
                    </div>
                    <div className="lg:col-span-2">
                         <label className="block text-sm font-medium text-slate-300 mb-2">Property Type</label>
                        <div className="flex flex-wrap gap-2">
                            {['All', 'apartment', 'house', 'room'].map(val => (
                                <button key={val} onClick={() => handleButtonClick('propertyType', val)} className={`px-3 py-1 rounded-full text-sm capitalize ${filters.propertyType === val ? 'bg-indigo-600' : 'bg-slate-700 hover:bg-slate-600'}`}>{val}</button>
                            ))}
                        </div>
                    </div>
                 </div>
            )}
        </div>
    );
};

const ReviewSummary = ({ propertyId }) => {
    const [summary, setSummary] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchSummary = async () => {
            if (!propertyId) return;
            setLoading(true);
            try {
                const { data } = await api.get(`/api/properties/${propertyId}/reviews/summary`);
                setSummary(data.summary);
            } catch (error) {
                console.error("Failed to fetch review summary", error);
                setSummary("Could not load AI summary at this time.");
            } finally {
                setLoading(false);
            }
        };
        fetchSummary();
    }, [propertyId]);

    if (loading) {
        return <div className="text-center text-slate-400">Generating AI Summary...</div>;
    }

    if (summary === "Not enough reviews to generate a summary.") {
        return null;
    }

    return (
        <div className="bg-slate-900/50 p-6 rounded-lg border border-indigo-500/30">
            <h3 className="text-xl font-semibold text-white mb-3 flex items-center gap-2">
                <Sparkles size={20} className="text-indigo-400" />
                AI Review Summary
            </h3>
            <div className="text-slate-300 whitespace-pre-line leading-relaxed">
                {summary.split('\n').map((line, index) => (
                    <span key={index} className="block mb-1">{line}</span>
                ))}
            </div>
        </div>
    );
};


// --- PAGE COMPONENTS (VIEWS) ---

const DashboardView = () => {
    const { currentUser } = useAuth();
    // Landlord state
    const [stats, setStats] = useState(null);
    // Student state
    const [featured, setFeatured] = useState([]);
    const [favorites, setFavorites] = useState([]);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                if (currentUser && currentUser.userType === 'landlord') {
                    const { data } = await api.get('/api/dashboard/stats');
                    setStats(data);
                } else if (currentUser && currentUser.userType === 'student') {
                    const [featuredRes, favoritesRes] = await Promise.all([
                        api.get('/api/properties/featured?limit=3'),
                        api.get('/api/favorites?limit=3')
                    ]);
                    setFeatured(featuredRes.data);
                    setFavorites(favoritesRes.data);
                }
                setError('');
            } catch (err) {
                if (err.response?.status !== 401 && err.response?.status !== 403) {
                    setError('Failed to load dashboard data. Please try again later.');
                }
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [currentUser]);


    if (loading) return <div className="text-center text-slate-400">Loading dashboard...</div>;
    if (error) return <div className="text-center text-red-400">{error}</div>;

    // --- LANDLORD VIEW ---
    if (currentUser.userType === 'landlord' && stats) {
        const propertyViewsData = stats.properties?.map(p => ({
            name: p.title.substring(0, 15) + (p.title.length > 15 ? '...' : ''),
            Views: p.view_count,
        })) || [];
        
        const favoritesData = [{ 
            name: 'Favorites', 
            value: stats.summary?.totalFavorites || 0,
            fill: '#f43f5e'
        }];

        return (
            <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 flex items-center gap-4"><div className="p-3 bg-indigo-600/20 rounded-lg"><Building size={28} className="text-indigo-400" /></div><div><p className="text-3xl font-bold text-white">{stats.summary.totalProperties}</p><p className="text-slate-400">Total Properties</p></div></div>
                    <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 flex items-center gap-4"><div className="p-3 bg-sky-600/20 rounded-lg"><Search size={28} className="text-sky-400" /></div><div><p className="text-3xl font-bold text-white">{stats.summary.totalViews}</p><p className="text-slate-400">Total Views</p></div></div>
                    <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 flex items-center gap-4"><div className="p-3 bg-rose-600/20 rounded-lg"><Heart size={28} className="text-rose-400" /></div><div><p className="text-3xl font-bold text-white">{stats.summary.totalFavorites}</p><p className="text-slate-400">Total Favorites</p></div></div>
                    <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 flex items-center gap-4"><div className="p-3 bg-emerald-600/20 rounded-lg"><MessageSquare size={28} className="text-emerald-400" /></div><div><p className="text-3xl font-bold text-white">{stats.summary.totalConversations}</p><p className="text-slate-400">Conversations</p></div></div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 bg-slate-800/50 p-6 rounded-2xl border border-slate-700"><h2 className="text-xl font-bold text-white mb-4">Property Views Analytics</h2>{propertyViewsData.length > 0 ? (<ResponsiveContainer width="100%" height={250}><BarChart data={propertyViewsData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}><CartesianGrid strokeDasharray="3 3" stroke="#374151" /><XAxis dataKey="name" stroke="#9ca3af" /><YAxis stroke="#9ca3af" /><Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} cursor={{ fill: 'rgba(129, 140, 248, 0.1)' }}/><Bar dataKey="Views" fill="#818cf8" /></BarChart></ResponsiveContainer>) : (<div className="h-[250px] flex items-center justify-center text-slate-500">Add a property to see view analytics.</div>)}</div>
                    <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 flex flex-col items-center justify-center"><h2 className="text-xl font-bold text-white mb-4">Total Favorites</h2><ResponsiveContainer width="100%" height={250}><RadialBarChart innerRadius="70%" outerRadius="90%" data={favoritesData} startAngle={90} endAngle={-270} barSize={30}><RadialBar minAngle={15} dataKey='value' cornerRadius={15} /><text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="text-4xl font-bold fill-white">{stats.summary.totalFavorites}</text></RadialBarChart></ResponsiveContainer></div>
                </div>
            </div>
        );
    }

    // --- STUDENT VIEW ---
    if (currentUser.userType === 'student') {
        return (
            <div className="space-y-10">
                <div className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700">
                    <h1 className="text-3xl font-bold text-white mb-2">Welcome back, {currentUser.username}!</h1>
                    <p className="text-slate-300 text-lg">Let's find your next place. Start by searching or check out some popular listings.</p>
                </div>

                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Star className="text-amber-400"/> Featured Properties</h2>
                        <Link to="/properties" className="text-indigo-400 hover:text-indigo-300 font-semibold transition">View All &rarr;</Link>
                    </div>
                    {featured.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {featured.map(prop => <PropertyCard key={prop._id} property={prop} />)}
                        </div>
                    ) : (
                         <div className="text-center py-10 text-slate-500">No featured properties available right now.</div>
                    )}
                </div>

                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Heart className="text-rose-500"/> Your Recent Favorites</h2>
                         <Link to="/favorites" className="text-indigo-400 hover:text-indigo-300 font-semibold transition">View All &rarr;</Link>
                    </div>
                    {favorites.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {favorites.map(prop => <PropertyCard key={prop._id} property={prop} />)}
                        </div>
                    ) : (
                         <div className="text-center py-10 text-slate-500">You haven't favorited any properties yet. Click the heart icon on a listing to save it!</div>
                    )}
                </div>
            </div>
        );
    }

    return null;
};

const PropertiesView = () => {
    const { currentUser } = useAuth();
    const navigate = useNavigate();
    const { searchTerm } = useSearch();
    const { filters } = useFilters();
    
    const [properties, setProperties] = useState([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    
    const [favorites, setFavorites] = useState(new Set());
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async (page) => {
        if (!currentUser) return;
        setLoading(true);
        try {
            const params = new URLSearchParams({
                search: searchTerm,
                page,
                city: filters.city,
                minPrice: filters.minPrice,
                maxPrice: filters.maxPrice,
                bedrooms: filters.bedrooms,
                propertyType: filters.propertyType,
            });
            
            if (filters.lat && filters.lng) {
                params.append('lat', filters.lat);
                params.append('lng', filters.lng);
            }
            
            const [propsRes, favsRes] = await Promise.all([
                api.get(`/api/properties?${params.toString()}`),
                currentUser.userType === 'student' ? api.get('/api/favorites') : Promise.resolve({ data: [] })
            ]);
            
            setProperties(propsRes.data.properties);
            setCurrentPage(propsRes.data.currentPage);
            setTotalPages(propsRes.data.totalPages);
            setFavorites(new Set(favsRes.data.map(fav => fav._id)));
        } catch (error) {
            toast.error("Failed to fetch properties.");
        } finally {
            setLoading(false);
        }
    }, [currentUser, searchTerm, filters]);

    useEffect(() => {
        fetchData(1); 
    }, [fetchData]);

    const handlePageChange = (newPage) => {
        if (newPage >= 1 && newPage <= totalPages) {
            fetchData(newPage);
        }
    };
    
    const handleDelete = async (propertyId) => {
        if (window.confirm('Are you sure you want to delete this property?')) {
            try {
                await api.delete(`/api/properties/${propertyId}`);
                toast.success('Property deleted successfully.');
                fetchData(currentPage);
            } catch (err) {
                toast.error('Failed to delete property.');
            }
        }
    };
    
    const handleEdit = (propertyId) => {
        navigate(`/edit-property/${propertyId}`);
    };

    const handleToggleFavorite = async (propertyId) => {
        const newFavorites = new Set(favorites);
        try {
            if (favorites.has(propertyId)) {
                await api.delete(`/api/favorites/${propertyId}`);
                newFavorites.delete(propertyId);
                toast.error('Property removed from favorites.');
            } else {
                await api.post('/api/favorites', { property_id: propertyId });
                newFavorites.add(propertyId);
                toast.success('Property added to your favorites!');
            }
            setFavorites(newFavorites);
        } catch (err) {
            toast.error('Failed to update favorites.');
        }
    };

    return (
        <div>
            <Filters />
            {loading ? (
                <div className="text-center text-slate-400 mt-10">Loading properties...</div>
            ) : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {properties.length > 0 ? properties.map(prop => (
                            <PropertyCard 
                                key={prop._id} 
                                property={prop}
                                isFavorite={favorites.has(prop._id)}
                                onToggleFavorite={currentUser.userType === 'student' ? handleToggleFavorite : null}
                                onEdit={currentUser.userType === 'landlord' && currentUser.uid === prop.landlord_id ? handleEdit : null}
                                onDelete={currentUser.userType === 'landlord' && currentUser.uid === prop.landlord_id ? handleDelete : null}
                            />
                        )) : (
                            <p className="col-span-3 text-center text-slate-400 text-lg">No properties found matching your criteria.</p>
                        )}
                    </div>
                    
                    {totalPages > 1 && (
                        <div className="flex justify-center items-center mt-12 space-x-4">
                            <button 
                                onClick={() => handlePageChange(currentPage - 1)} 
                                disabled={currentPage === 1}
                                className="px-4 py-2 bg-slate-800 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-600"
                            >
                                Previous
                            </button>
                            <span className="text-slate-300">
                                Page {currentPage} of {totalPages}
                            </span>
                            <button 
                                onClick={() => handlePageChange(currentPage + 1)} 
                                disabled={currentPage === totalPages}
                                className="px-4 py-2 bg-slate-800 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-600"
                            >
                                Next
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

const AddPropertyView = () => {
    const navigate = useNavigate();
    const [details, setDetails] = useState({ 
        title: '', description: '', address: '', city: '', price: '', 
        property_type: 'apartment', bedrooms: '', bathrooms: '', amenities: '',
        lat: '', lng: '', virtual_tour_url: '' 
    });
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    
    const [aiPrompt, setAiPrompt] = useState('');
    const [aiLoading, setAiLoading] = useState(false);

    const handleChange = (e) => setDetails({ ...details, [e.target.name]: e.target.value });
    const handleImageChange = (e) => setImages(e.target.files);

    const handleGenerateDescription = async () => {
        if (!aiPrompt) {
            toast.error("Please enter some keywords first (e.g., '3 bed, modern, near park').");
            return;
        }
        setAiLoading(true);
        try {
            const { data } = await api.post('/api/properties/generate-description', { prompt: aiPrompt });
            setDetails(prev => ({ ...prev, description: data.description }));
            toast.success("Description generated successfully!");
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to generate description.');
        } finally {
            setAiLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        const formData = new FormData();
        Object.keys(details).forEach(key => formData.append(key, details[key]));
        for (let i = 0; i < images.length; i++) {
            formData.append('images', images[i]);
        }

        try {
            await api.post('/api/properties', formData);
            toast.success('Property added successfully!');
            navigate('/properties');
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to add property.');
        } finally {
            setLoading(false);
        }
    };
    
    return (
        <div className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700 max-w-4xl mx-auto">
            {error && <div className="bg-red-900/50 border border-red-700 text-red-300 p-3 rounded-lg mb-6">{error}</div>}
            
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-300 mb-1">Property Title</label><input name="title" required value={details.title} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white"/></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-1">Address</label><input name="address" required value={details.address} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white"/></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-1">City</label><input name="city" required value={details.city} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white"/></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-1">Price (per month)</label><input name="price" type="number" required value={details.price} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white"/></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-1">Property Type</label><select name="property_type" value={details.property_type} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white"><option value="apartment">Apartment</option><option value="house">House</option><option value="room">Room</option></select></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-1">Bedrooms</label><input name="bedrooms" type="number" value={details.bedrooms} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white"/></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-1">Bathrooms</label><input name="bathrooms" type="number" value={details.bathrooms} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white"/></div>
                
                <div className="md:col-span-2 space-y-3 p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                    <label className="block text-sm font-medium text-indigo-300">Generate Description with AI</label>
                    <p className="text-sm text-slate-400">Enter keywords (e.g., "3 bed, sunny, modern kitchen, near park") and let AI write the description for you.</p>
                    <div className="flex gap-2">
                        <input 
                            type="text" 
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            placeholder="Enter keywords..." 
                            className="flex-grow bg-slate-800 border border-slate-600 rounded-lg p-2.5 text-white"
                        />
                        <button 
                            type="button" 
                            onClick={handleGenerateDescription} 
                            disabled={aiLoading}
                            className="flex items-center gap-2 bg-indigo-600 text-white font-semibold py-2.5 px-4 rounded-lg hover:bg-indigo-500 disabled:bg-indigo-800"
                        >
                            <Sparkles size={16} />
                            {aiLoading ? 'Generating...' : 'Generate'}
                        </button>
                    </div>
                </div>

                <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-300 mb-1">Description</label><textarea name="description" rows="5" value={details.description} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white"></textarea></div>
                
                <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-300 mb-1">Amenities (comma-separated)</label><input name="amenities" value={details.amenities} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white"/></div>
                
                <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-300 mb-1">Virtual Tour URL (Optional)</label><input name="virtual_tour_url" value={details.virtual_tour_url} onChange={handleChange} placeholder="https://my.matterport.com/show/..." className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white"/></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-1">Latitude (Optional)</label><input name="lat" type="number" value={details.lat} onChange={handleChange} placeholder="e.g., 19.0760" className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white"/></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-1">Longitude (Optional)</label><input name="lng" type="number" value={details.lng} onChange={handleChange} placeholder="e.g., 72.8777" className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white"/></div>
                <p className="md:col-span-2 text-xs text-slate-400 -mt-4">You can get Latitude and Longitude by right-clicking on a location in Google Maps.</p>

                <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-300 mb-1">Images (up to 5)</label><input type="file" name="images" onChange={handleImageChange} className="w-full text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 cursor-pointer" multiple/></div>
                <div className="md:col-span-2 mt-4"><button type="submit" disabled={loading} className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-500 transition disabled:bg-green-800">
                    {loading ? 'Submitting...' : 'Add Property'}
                </button></div>
            </form>
        </div>
    );
};

const EditPropertyView = () => {
    const { propertyId } = useParams();
    const navigate = useNavigate();
    const [details, setDetails] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        const fetchProperty = async () => {
            setLoading(true);
            try {
                const response = await api.get(`/api/properties/${propertyId}`);
                setDetails(response.data);
            } catch (err) {
                setError('Failed to fetch property details.');
                toast.error('Failed to load property data.');
            } finally {
                setLoading(false);
            }
        };
        fetchProperty();
    }, [propertyId]);
    
    const handleChange = (e) => setDetails({ ...details, [e.target.name]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setMessage('');

        try {
            await api.put(`/api/properties/${propertyId}`, details);
            setMessage('Property updated successfully! Redirecting...');
            toast.success('Property updated!');
            setTimeout(() => navigate('/properties'), 2000);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to update property.');
            toast.error('Failed to update property.');
        } finally {
            setLoading(false);
        }
    };

    if (loading && !details) return <div className="text-center text-slate-400">Loading property details...</div>;
    if (error) return <div className="text-center text-red-400">{error}</div>;

    return (
        <div className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700 max-w-4xl mx-auto">
            {message && <div className="bg-green-900/50 border border-green-700 text-green-300 p-3 rounded-lg mb-6">{message}</div>}
            {details && (
                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-300 mb-1">Property Title</label><input name="title" required value={details.title} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white focus:ring-indigo-500 focus:border-indigo-500"/></div>
                    <div><label className="block text-sm font-medium text-slate-300 mb-1">Address</label><input name="address" required value={details.address} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white focus:ring-indigo-500 focus:border-indigo-500"/></div>
                    <div><label className="block text-sm font-medium text-slate-300 mb-1">City</label><input name="city" required value={details.city} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white focus:ring-indigo-500 focus:border-indigo-500"/></div>
                    <div><label className="block text-sm font-medium text-slate-300 mb-1">Price (per month)</label><input name="price" type="number" required value={details.price} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white focus:ring-indigo-500 focus:border-indigo-500"/></div>
                    <div><label className="block text-sm font-medium text-slate-300 mb-1">Property Type</label><select name="property_type" value={details.property_type} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white focus:ring-indigo-500 focus:border-indigo-500"><option value="apartment">Apartment</option><option value="house">House</option><option value="room">Room</option></select></div>
                    <div><label className="block text-sm font-medium text-slate-300 mb-1">Bedrooms</label><input name="bedrooms" type="number" value={details.bedrooms} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white focus:ring-indigo-500 focus:border-indigo-500"/></div>
                    <div><label className="block text-sm font-medium text-slate-300 mb-1">Bathrooms</label><input name="bathrooms" type="number" value={details.bathrooms} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white focus:ring-indigo-500 focus:border-indigo-500"/></div>
                    <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-300 mb-1">Description</label><textarea name="description" rows="4" value={details.description} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white focus:ring-indigo-500 focus:border-indigo-500"></textarea></div>
                    <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-300 mb-1">Amenities (comma-separated)</label><input name="amenities" value={details.amenities} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white focus:ring-indigo-500 focus:border-indigo-500"/></div>
                    <div className="md:col-span-2 mt-4"><button type="submit" disabled={loading} className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-500 transition disabled:bg-indigo-800 disabled:cursor-not-allowed">{loading ? 'Updating...' : 'Save Changes'}</button></div>
                </form>
            )}
        </div>
    );
};

const PropertyDetailsView = () => {
    const { currentUser } = useAuth();
    const navigate = useNavigate();
    const { propertyId } = useParams();
    const [property, setProperty] = useState(null);
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedImage, setSelectedImage] = useState(null);
    const effectRan = useRef(false);

    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState('');
    const [reviewLoading, setReviewLoading] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [propertyRes, reviewsRes] = await Promise.all([
                api.get(`/api/properties/${propertyId}`),
                api.get(`/api/properties/${propertyId}/reviews`)
            ]);
            
            setProperty(propertyRes.data);
            setReviews(reviewsRes.data);

            if (propertyRes.data.images && propertyRes.data.images.length > 0) {
                setSelectedImage(propertyRes.data.images[0]);
            } else if (propertyRes.data.image_url) {
                setSelectedImage(propertyRes.data.image_url);
            }
        } catch (err) {
            setError('Failed to fetch property details.');
        } finally {
            setLoading(false);
        }
    }, [propertyId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        if (effectRan.current === false && propertyId) {
            const recordView = async () => {
                try {
                    await api.post(`/api/properties/${propertyId}/view`);
                } catch (err) {
                    console.error("Failed to record property view:", err);
                }
            };
            recordView();
            return () => { effectRan.current = true; };
        }
    }, [propertyId]);

    const handleContact = async () => {
        try {
            const response = await api.post('/api/conversations', { 
                property_id: property._id, 
                landlord_id: property.landlord_id 
            });
            navigate(`/messages/${response.data.conversationId}`);
        } catch (err) {
            toast.error(err.response?.data?.message || "Could not start conversation.");
        }
    };

    const handleReviewSubmit = async (e) => {
        e.preventDefault();
        if (rating === 0 || !comment) {
            toast.error("Please provide a rating and a comment.");
            return;
        }
        setReviewLoading(true);
        try {
            const { data } = await api.post(`/api/properties/${propertyId}/reviews`, { rating, comment });
            setReviews([data, ...reviews]);
            setRating(0);
            setComment('');
            toast.success("Review submitted successfully!");
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed to submit review.");
        } finally {
            setReviewLoading(false);
        }
    };

    if (loading) return <div className="text-center text-slate-400">Loading details...</div>;
    if (error) return <div className="text-center text-red-400">{error}</div>;
    if (!property) return <div className="text-center text-slate-400">Property not found.</div>;

    const uniqueImages = [...new Set([property.image_url, ...property.images].filter(Boolean))];
    const averageRating = reviews.length > 0 ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length : 0;
    
    const mapEmbedUrl = property.lat && property.lng 
        ? `https://www.openstreetmap.org/export/embed.html?bbox=${property.lng - 0.005},${property.lat - 0.005},${property.lng + 0.005},${property.lat + 0.005}&layer=mapnik&marker=${property.lat},${property.lng}`
        : null;

    return (
        <div className="space-y-8">
            <div className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700 max-w-6xl mx-auto">
                 <Link to="/properties" className="mb-6 inline-flex items-center px-4 py-2 border border-slate-600 rounded-full hover:bg-slate-700 text-slate-300 transition-colors"><ArrowLeft size={20} className="mr-2" /> Back to Listings</Link>
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                    <div className="lg:col-span-3">
                        <div className="mb-4">
                            <img src={selectedImage || 'https://placehold.co/800x600/1e293b/94a3b8?text=No+Image'} alt={property.title} className="w-full h-[450px] object-cover rounded-xl shadow-lg"/>
                        </div>
                        {uniqueImages.length > 1 && (
                            <div className="flex overflow-x-auto space-x-2 p-2 bg-slate-900/50 rounded-lg">
                                {uniqueImages.map((image, index) => (
                                    <img key={index} src={image} alt={`Thumbnail ${index + 1}`} className={`w-24 h-20 object-cover rounded-md cursor-pointer border-2 transition-all ${selectedImage === image ? 'border-indigo-500' : 'border-transparent hover:border-slate-500'}`} onClick={() => setSelectedImage(image)}/>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="lg:col-span-2">
                        <h1 className="text-4xl font-extrabold text-white mb-2">{property.title}</h1>
                        
                        <div className="flex items-center gap-2 mb-4">
                            <StarRating rating={averageRating} />
                            <span className="text-slate-400 text-sm">({reviews.length} reviews)</span>
                        </div>

                        <p className="text-indigo-400 text-3xl font-bold mb-6">₹{property.price.toLocaleString()}<span className="text-base text-slate-400 font-normal"> / month</span></p>
                        
                        <div className="space-y-4 text-slate-300 text-lg my-8 border-y border-slate-700 py-6">
                            <div className="flex items-center"><MapPin className="mr-3 text-indigo-400" size={20} /><span>{property.address}, {property.city}</span></div>
                            <div className="flex items-center"><Home className="mr-3 text-indigo-400" size={20} /><span>{property.property_type}</span></div>
                            {property.bedrooms && <div className="flex items-center"><Bed className="mr-3 text-indigo-400" size={20} /><span>{property.bedrooms} Bedrooms</span></div>}
                            {property.bathrooms && <div className="flex items-center"><Bath className="mr-3 text-indigo-400" size={20} /><span>{property.bathrooms} Bathrooms</span></div>}
                        </div>

                        {property.description && <div className="mb-8"><h3 className="text-2xl font-bold text-white mb-3">Description</h3><p className="leading-relaxed text-slate-300">{property.description}</p></div>}
                        {property.amenities && <div className="mb-8"><h3 className="text-2xl font-bold text-white mb-3">Amenities</h3><div className="flex flex-wrap gap-3">{property.amenities.split(',').map((a, i) => <span key={i} className="px-4 py-2 bg-slate-700 text-indigo-300 rounded-full text-sm font-medium">{a.trim()}</span>)}</div></div>}
                        
                        {property.virtual_tour_url && (
                             <a href={property.virtual_tour_url} target="_blank" rel="noopener noreferrer" className="w-full mb-4 bg-indigo-600 text-white font-bold py-3 px-6 rounded-full shadow-lg flex items-center justify-center hover:bg-indigo-500 transition-colors">
                                <Video className="mr-2" /> View Virtual Tour
                            </a>
                        )}
                        
                        {currentUser && currentUser.userType === 'student' && property.landlord_id !== currentUser.uid && (
                            <button onClick={handleContact} className="w-full bg-green-600 text-white font-bold py-3 px-6 rounded-full shadow-lg flex items-center justify-center hover:bg-green-500 transition-colors">
                                <MessageSquare className="mr-2" /> Contact Landlord
                            </button>
                        )}
                    </div>
                </div>
            </div>
            
            {mapEmbedUrl && (
                <div className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700 max-w-6xl mx-auto">
                    <h2 className="text-2xl font-bold text-white mb-6">Location</h2>
                    <div className="overflow-hidden rounded-xl border border-slate-700">
                         <iframe 
                            width="100%" 
                            height="450" 
                            frameBorder="0" 
                            scrolling="no" 
                            marginHeight="0" 
                            marginWidth="0" 
                            src={mapEmbedUrl}
                            style={{ border: 0 }}
                            allowFullScreen
                        ></iframe>
                    </div>
                </div>
            )}

            <div className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700 max-w-6xl mx-auto">
                <h2 className="text-2xl font-bold text-white mb-6">Reviews ({reviews.length})</h2>
                
                {reviews.length > 1 && (
                    <ReviewSummary propertyId={propertyId} />
                )}

                {currentUser.userType === 'student' && (
                    <form onSubmit={handleReviewSubmit} className="my-8 p-6 bg-slate-900/50 rounded-lg">
                        <h3 className="text-xl font-semibold text-white mb-4">Leave a Review</h3>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-slate-300 mb-2">Your Rating</label>
                            <div className="flex space-x-1">
                                {[...Array(5)].map((_, i) => (
                                    <button type="button" key={i} onClick={() => setRating(i + 1)}>
                                        <Star size={24} className={i < rating ? "text-amber-400 fill-amber-400" : "text-slate-600 hover:text-amber-400"} />
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="mb-4">
                             <label className="block text-sm font-medium text-slate-300 mb-2">Your Comment</label>
                             <textarea 
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                                rows="4" 
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white"
                                placeholder="Share your experience with this property..."
                            />
                        </div>
                        <button type="submit" disabled={reviewLoading} className="bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg">
                            {reviewLoading ? "Submitting..." : "Submit Review"}
                        </button>
                    </form>
                )}

                <div className="space-y-6 mt-8">
                    {reviews.length > 0 ? reviews.map(review => (
                        <div key={review._id} className="flex gap-4 border-b border-slate-700 pb-4">
                            <img 
                                src={review.user_id.profilePictureUrl || `https://placehold.co/100x100/1e293b/a78bfa?text=${review.user_id.username.charAt(0).toUpperCase()}`} 
                                alt={review.user_id.username}
                                className="h-10 w-10 rounded-full object-cover"
                            />
                            <div className="flex-1">
                                <div className="flex justify-between items-center">
                                    <h4 className="font-semibold text-white">{review.user_id.username}</h4>
                                    <StarRating rating={review.rating} />
                                </div>
                                <p className="text-sm text-slate-400 mb-2">{new Date(review.createdAt).toLocaleDateString()}</p>
                                <p className="text-slate-300">{review.comment}</p>
                            </div>
                        </div>
                    )) : (
                        <p className="text-slate-400">No reviews yet. Be the first to leave one!</p>
                    )}
                </div>
            </div>
        </div>
    );
};

const FavoritesView = () => {
    // ... This component is now fully implemented below
    const [favoriteProperties, setFavoriteProperties] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchFavorites = useCallback(async () => {
        setLoading(true);
        try {
            const response = await api.get('/api/favorites');
            setFavoriteProperties(response.data);
        } catch (err) {
            setError('Failed to fetch your favorite properties.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchFavorites();
    }, [fetchFavorites]);

    if (loading) return <div className="text-center text-slate-400">Loading favorites...</div>;
    if (error) return <div className="text-center text-red-400">{error}</div>;

    return (
        <div>
            {favoriteProperties.length === 0 ? (
                <p className="text-center text-slate-400 text-lg">You haven't saved any properties yet.</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {favoriteProperties.map(prop => (
                        <PropertyCard key={prop._id} property={prop} />
                    ))}
                </div>
            )}
        </div>
    );
};

const MessagesView = () => {
    const { currentUser } = useAuth();
    const { conversationId } = useParams();
    const { lastMessage, sendMessage } = useWebSocket();
    const [conversations, setConversations] = useState([]);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [aiLoading, setAiLoading] = useState(false);
    const navigate = useNavigate();
    const messagesEndRef = useRef(null);

    const activeConversation = conversations.find(c => c._id === conversationId);

    useEffect(() => {
        const fetchConversations = async () => {
            setLoading(true);
            try {
                const response = await api.get('/api/conversations');
                setConversations(response.data);
            } catch (error) {
                console.error("Failed to fetch conversations", error);
            } finally {
                setLoading(false);
            }
        };
        fetchConversations();
    }, []);

    useEffect(() => {
        if (!conversationId) return;
        const fetchMessages = async () => {
            try {
                const response = await api.get(`/api/conversations/${conversationId}/messages`);
                setMessages(response.data);
            } catch (error) {
                console.error("Failed to fetch messages", error);
            }
        };
        fetchMessages();
    }, [conversationId]);

    useEffect(() => {
        if (lastMessage) {
            const data = JSON.parse(lastMessage);
            if (data.type === 'newMessage' && data.payload.conversation_id === conversationId) {
                setMessages(prev => {
                    if (prev.some(msg => msg._id === data.payload._id)) {
                        return prev;
                    }
                    return [...prev, data.payload];
                });
            }
        }
    }, [lastMessage, conversationId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSendMessage = (e) => {
        e.preventDefault();
        if (!newMessage.trim()) return;
        
        sendMessage(JSON.stringify({
            type: 'message',
            payload: { conversation_id: conversationId, content: newMessage }
        }));
        setNewMessage("");
    };

    // NEW: Handle "Ask AI"
    const handleAskAI = async (e) => {
        e.preventDefault();
        if (!newMessage.trim()) {
            toast.error("Please type a question for the AI.");
            return;
        }

        const question = newMessage;
        setAiLoading(true);
        setNewMessage(""); // Clear input immediately

        try {
            // Optimistically display the user's question
            const userQuestionMessage = {
                _id: Date.now(),
                conversation_id: conversationId,
                sender_id: currentUser.uid,
                content: `(AI Question): ${question}`,
                createdAt: new Date().toISOString()
            };
            setMessages(prev => [...prev, userQuestionMessage]);

            await api.post(`/api/conversations/${conversationId}/ask-ai`, { question });
            // The AI's response will arrive via the WebSocket and be added by the useEffect hook
        } catch (err) {
            toast.error(err.response?.data?.message || "AI assistant failed to respond.");
        } finally {
            setAiLoading(false);
        }
    };


    if (loading) return <div className="text-center text-slate-400">Loading conversations...</div>;

    return (
        <div className="h-[calc(100vh-12rem)] bg-slate-800/50 rounded-2xl border border-slate-700 flex">
            <div className="w-1/3 border-r border-slate-700 overflow-y-auto">
                {conversations.map(convo => {
                    const otherUser = currentUser.userType === 'student' ? convo.landlord_id : convo.student_id;
                    return (
                        <div key={convo._id} onClick={() => navigate(`/messages/${convo._id}`)} className={`p-4 cursor-pointer hover:bg-slate-700/50 transition-colors ${conversationId === convo._id ? 'bg-indigo-900/50' : ''}`}>
                            <p className="font-semibold text-white truncate">{otherUser?.username || 'Unknown User'}</p>
                            <p className="text-sm text-slate-400 truncate">{convo.property_id?.title || 'Property Deleted'}</p>
                        </div>
                    );
                })}
            </div>
            <div className="w-2/3 flex flex-col">
                {activeConversation ? (
                    <>
                        <div className="p-4 border-b border-slate-700">
                            <h3 className="font-bold text-lg text-white">{(currentUser.userType === 'student' ? activeConversation.landlord_id?.username : activeConversation.student_id?.username) || 'Unknown User'}</h3>
                            <p className="text-sm text-slate-400">{activeConversation.property_id?.title || 'Property Deleted'}</p>
                        </div>
                        <div className="flex-1 p-4 overflow-y-auto bg-slate-900/50">
                            {messages.map((msg, index) => (
                                <div key={msg._id || index} className={`mb-4 flex flex-col ${String(msg.sender_id) === currentUser.uid ? 'items-end' : 'items-start'}`}>
                                    <div className={`rounded-xl px-4 py-2 max-w-md text-white ${String(msg.sender_id) === currentUser.uid ? 'bg-indigo-600' : 'bg-slate-700'}`}>{msg.content}</div>
                                </div>
                            ))}
                            <div ref={messagesEndRef} />
                        </div>
                        <form className="p-4 border-t border-slate-700 flex items-center gap-2">
                            <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Type a message..." className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-full text-white focus:ring-indigo-500 focus:border-indigo-500"/>
                            
                            {/* UPDATED: Send and Ask AI buttons */}
                            {currentUser.userType === 'student' && (
                                <button 
                                    type="button" 
                                    onClick={handleAskAI} 
                                    disabled={aiLoading || !newMessage.trim()} 
                                    className="bg-purple-600 text-white p-3 rounded-full hover:bg-purple-500 transition-colors disabled:bg-purple-800"
                                    title="Ask AI about this property"
                                >
                                    {aiLoading ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div> : <Brain size={20} />}
                                </button>
                            )}
                            <button 
                                type="submit" 
                                onClick={handleSendMessage} 
                                className="bg-indigo-600 text-white p-3 rounded-full hover:bg-indigo-500 transition-colors disabled:bg-indigo-800" 
                                disabled={!newMessage.trim()}
                                title="Send Message"
                            >
                                <Send size={20} />
                            </button>
                        </form>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center"><p className="text-slate-500 text-lg">Select a conversation to start chatting.</p></div>
                )}
            </div>
        </div>
    );
};

const ProfileView = () => {
    const { currentUser, setCurrentUser, logout } = useAuth();
    const navigate = useNavigate();
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    
    const [activeTab, setActiveTab] = useState('profile');

    const [isEditingUsername, setIsEditingUsername] = useState(false);
    const [newUsername, setNewUsername] = useState(currentUser.username);
    const [usernameLoading, setUsernameLoading] = useState(false);
    
    const [isEditingBio, setIsEditingBio] = useState(false);
    const [bio, setBio] = useState(currentUser.bio || '');
    const [bioLoading, setBioLoading] = useState(false);

    const [showPasswordForm, setShowPasswordForm] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordLoading, setPasswordLoading] = useState(false);

    const [pictureLoading, setPictureLoading] = useState(false);
    const fileInputRef = useRef(null);

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deletePassword, setDeletePassword] = useState('');
    const [deleteLoading, setDeleteLoading] = useState(false);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const { data } = await api.get('/api/profile/stats');
                setStats(data);
            } catch (err) {
                setError('Could not load profile statistics.');
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, []);

    const handleUsernameUpdate = async (e) => {
        e.preventDefault();
        if (newUsername.trim() === currentUser.username) {
            setIsEditingUsername(false);
            return;
        }
        setUsernameLoading(true);
        try {
            const { data } = await api.put('/api/profile/update-username', { newUsername });
            toast.success(data.message);
            localStorage.setItem('token', data.token);
            setCurrentUser({ ...currentUser, username: data.newUsername });
            setIsEditingUsername(false);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to update username.');
        } finally {
            setUsernameLoading(false);
        }
    };

    const handlePasswordChange = async (e) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            toast.error("New passwords do not match.");
            return;
        }
        if (newPassword.length < 6) {
            toast.error("New password must be at least 6 characters long.");
            return;
        }

        setPasswordLoading(true);
        try {
            const { data } = await api.post('/api/profile/change-password', { currentPassword, newPassword });
            toast.success(data.message);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setShowPasswordForm(false);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to update password.');
        } finally {
            setPasswordLoading(false);
        }
    };

    const handlePictureChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('profilePicture', file);

        setPictureLoading(true);
        try {
            const { data } = await api.put('/api/profile/upload-picture', formData);
            setCurrentUser({ ...currentUser, profilePictureUrl: data.profilePictureUrl });
            toast.success(data.message);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to upload picture.');
        } finally {
            setPictureLoading(false);
        }
    };

    const handleBioUpdate = async (e) => {
        e.preventDefault();
        setBioLoading(true);
        try {
            const { data } = await api.put('/api/profile/update-bio', { bio });
            toast.success(data.message);
            setCurrentUser({ ...currentUser, bio: data.bio });
            setIsEditingBio(false);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to update bio.');
        } finally {
            setBioLoading(false);
        }
    };

    const handleDeleteAccount = async (e) => {
        e.preventDefault();
        setDeleteLoading(true);
        try {
            const { data } = await api.post('/api/profile/delete-account', { password: deletePassword });
            toast.success(data.message);
            setIsDeleteModalOpen(false);
            logout();
            navigate('/login');
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to delete account.');
        } finally {
            setDeleteLoading(false);
        }
    };

    if (loading) return <div className="text-center text-slate-400">Loading profile...</div>;
    if (error) return <div className="text-center text-red-400">{error}</div>;

    const statCards = currentUser.userType === 'student' ? [
        { icon: Heart, label: "Properties Favorited", value: stats?.favoritesCount || 0, color: "text-rose-400" },
        { icon: MessageSquare, label: "Conversations Started", value: stats?.conversationsCount || 0, color: "text-emerald-400" }
    ] : [
        { icon: Building, label: "Properties Listed", value: stats?.propertiesCount || 0, color: "text-indigo-400" },
        { icon: MessageSquare, label: "Active Conversations", value: stats?.conversationsCount || 0, color: "text-emerald-400" }
    ];

    return (
        <div className="max-w-4xl mx-auto">
            <div className="mb-8 border-b border-slate-700">
                <nav className="-mb-px flex space-x-6">
                    <button onClick={() => setActiveTab('profile')} className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'profile' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-white hover:border-slate-500'}`}>Profile</button>
                    <button onClick={() => setActiveTab('security')} className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'security' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-white hover:border-slate-500'}`}>Security</button>
                    <button onClick={() => setActiveTab('danger')} className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'danger' ? 'border-red-500 text-red-400' : 'border-transparent text-slate-400 hover:text-white hover:border-slate-500'}`}>Danger Zone</button>
                </nav>
            </div>

            <div className="space-y-8">
                {activeTab === 'profile' && (
                    <>
                        <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 flex flex-col md:flex-row items-center gap-6">
                           <div className="relative group">
                                <img 
                                    className="h-24 w-24 rounded-full object-cover" 
                                    src={currentUser.profilePictureUrl || `https://placehold.co/100x100/1e293b/a78bfa?text=${(currentUser.username || 'U').charAt(0).toUpperCase()}`} 
                                    alt="User Avatar" 
                                />
                                <button 
                                    onClick={() => fileInputRef.current.click()}
                                    className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                    disabled={pictureLoading}
                                >
                                    {pictureLoading ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div> : <UploadCloud size={24} />}
                                </button>
                                <input 
                                    type="file" 
                                    ref={fileInputRef} 
                                    onChange={handlePictureChange} 
                                    className="hidden" 
                                    accept="image/png, image/jpeg"
                                />
                            </div>
                            <div className="flex-grow w-full">
                                {!isEditingUsername ? (
                                    <div className="flex items-center gap-4">
                                        <h1 className="text-3xl font-bold text-white">{currentUser.username}</h1>
                                        <button onClick={() => { setIsEditingUsername(true); setNewUsername(currentUser.username); }} className="text-slate-400 hover:text-white">
                                            <Edit size={20} />
                                        </button>
                                    </div>
                                ) : (
                                    <form onSubmit={handleUsernameUpdate} className="flex items-center gap-2">
                                        <input 
                                            type="text"
                                            value={newUsername}
                                            onChange={(e) => setNewUsername(e.target.value)}
                                            className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-white focus:ring-indigo-500 focus:border-indigo-500"
                                        />
                                        <button type="submit" disabled={usernameLoading} className="bg-green-600 text-white p-2 rounded-lg hover:bg-green-500">Save</button>
                                        <button type="button" onClick={() => setIsEditingUsername(false)} className="bg-slate-600 text-white p-2 rounded-lg hover:bg-slate-500">Cancel</button>
                                    </form>
                                )}
                                <p className="text-slate-400 mt-1">{currentUser.email}</p>
                                <span className="mt-2 inline-block px-3 py-1 text-xs font-semibold rounded-full bg-indigo-600 text-white">{currentUser.userType}</span>
                            </div>
                        </div>
                         <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700">
                             {!isEditingBio ? (
                                <div className="flex items-start justify-between">
                                    <div>
                                        <h2 className="text-xl font-bold text-white mb-2">About Me</h2>
                                        <p className="text-slate-400 italic">{currentUser.bio || "You haven't added a bio yet."}</p>
                                    </div>
                                    <button onClick={() => { setIsEditingBio(true); setBio(currentUser.bio || ''); }} className="text-slate-400 hover:text-white">
                                        <Edit size={16}/>
                                    </button>
                                </div>
                            ) : (
                                <form onSubmit={handleBioUpdate} className="space-y-2">
                                    <h2 className="text-xl font-bold text-white mb-2">Edit Your Bio</h2>
                                    <textarea
                                        value={bio}
                                        onChange={(e) => setBio(e.target.value)}
                                        maxLength="250"
                                        className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-white"
                                        rows="3"
                                    />
                                    <div className="flex gap-2">
                                        <button type="submit" disabled={bioLoading} className="bg-green-600 text-white font-bold py-2 px-4 rounded-lg">{bioLoading ? 'Saving...' : 'Save Bio'}</button>
                                        <button type="button" onClick={() => setIsEditingBio(false)} className="bg-slate-600 text-white font-bold py-2 px-4 rounded-lg">Cancel</button>
                                    </div>
                                </form>
                            )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {statCards.map(stat => (
                                <div key={stat.label} className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 flex items-center gap-4">
                                    <stat.icon size={28} className={stat.color} />
                                    <div>
                                        <p className="text-3xl font-bold text-white">{stat.value}</p>
                                        <p className="text-slate-400">{stat.label}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
                
                {activeTab === 'security' && (
                    <div className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700">
                        <div className="flex justify-between items-center">
                            <div>
                                <h2 className="text-2xl font-bold text-white">Change Password</h2>
                                <p className="text-slate-400 mt-1">Update your password to keep your account secure.</p>
                            </div>
                            {!showPasswordForm && (
                                <button onClick={() => setShowPasswordForm(true)} className="bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg">
                                    Change
                                </button>
                            )}
                        </div>
                        {showPasswordForm && (
                            <form onSubmit={handlePasswordChange} className="space-y-4 mt-6">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1">Current Password</label>
                                    <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1">New Password</label>
                                    <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1">Confirm New Password</label>
                                    <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white" />
                                </div>
                                <div className="pt-2 flex gap-4">
                                    <button type="submit" disabled={passwordLoading} className="bg-indigo-600 text-white font-bold py-2.5 px-6 rounded-lg">
                                        {passwordLoading ? 'Updating...' : 'Update Password'}
                                    </button>
                                    <button type="button" onClick={() => setShowPasswordForm(false)} className="bg-slate-600 text-white font-bold py-2.5 px-6 rounded-lg">
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                )}

                {activeTab === 'danger' && (
                    <div className="bg-slate-800/50 p-8 rounded-2xl border border-red-500/50">
                        <h2 className="text-2xl font-bold text-red-400 mb-4 flex items-center gap-2"><AlertTriangle/> Danger Zone</h2>
                        <p className="text-slate-400 mb-6">Permanently delete your account and all of your content. This action is not reversible.</p>
                        <button onClick={() => setIsDeleteModalOpen(true)} className="bg-red-600 text-white font-bold py-2.5 px-6 rounded-lg hover:bg-red-500 transition">
                            Delete My Account
                        </button>
                    </div>
                )}
            </div>
            
            {isDeleteModalOpen && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
                    <div className="bg-slate-800 rounded-2xl p-8 border border-slate-700 max-w-md w-full">
                        <h2 className="text-2xl font-bold text-white mb-4">Are you absolutely sure?</h2>
                        <p className="text-slate-400 mb-6">This action cannot be undone. To confirm, please type your password below.</p>
                        <form onSubmit={handleDeleteAccount}>
                            <input 
                                type="password"
                                placeholder="Enter your password to confirm"
                                value={deletePassword}
                                onChange={(e) => setDeletePassword(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2.5 text-white mb-6"
                            />
                            <div className="flex justify-end gap-4">
                                <button type="button" onClick={() => setIsDeleteModalOpen(false)} className="bg-slate-600 text-white font-bold py-2 px-4 rounded-lg">Cancel</button>
                                <button type="submit" disabled={deleteLoading || !deletePassword} className="bg-red-600 text-white font-bold py-2 px-4 rounded-lg disabled:bg-red-800 disabled:cursor-not-allowed">
                                    {deleteLoading ? 'Deleting...' : 'Delete Account'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};


const AuthForm = ({ isLogin }) => {
    const { setCurrentUser } = useAuth();
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [userType, setUserType] = useState('student');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!isLogin && password !== confirmPassword) {
            return setError('Passwords do not match');
        }
        setLoading(true);
        const endpoint = isLogin ? '/api/login' : '/api/signup';
        const payload = isLogin ? { email, password } : { username, email, password, userType };
        try {
            const { data } = await api.post(endpoint, payload);
            setCurrentUser({ 
                email: data.email, 
                uid: data.userId, 
                userType: data.userType, 
                username: data.username,
                profilePictureUrl: data.profilePictureUrl,
                bio: data.bio
            });
            localStorage.setItem("token", data.token);
            localStorage.setItem('currentUser', JSON.stringify(response.data.user));
            navigate("/");
        } catch (err) {
            setError(err.response?.data?.message || 'An error occurred.');
        } finally {
            setLoading(false);
        }
    };
    
    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
            <div className="max-w-md w-full bg-slate-800/60 backdrop-blur-sm border border-slate-700 shadow-2xl shadow-indigo-900/50 rounded-2xl p-8">
                <h2 className="text-3xl font-extrabold text-center text-white mb-6">{isLogin ? 'Login to Housing Hub' : 'Create Your Account'}</h2>
                {error && (<div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-xl mb-4 text-center">{error}</div>)}
                <form className="space-y-6" onSubmit={handleSubmit}>
                    {!isLogin && (
                         <div><label htmlFor="username" className="block text-sm font-medium text-slate-300">Username</label><input id="username" type="text" required value={username} onChange={(e) => setUsername(e.target.value)} className="mt-1 block w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg shadow-sm text-white focus:ring-indigo-500 focus:border-indigo-500" placeholder="e.g. john_doe" /></div>
                    )}
                    <div><label htmlFor="email" className="block text-sm font-medium text-slate-300">Email address</label><input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg shadow-sm text-white focus:ring-indigo-500 focus:border-indigo-500" placeholder="your@email.com" /></div>
                    <div><label htmlFor="password" className="block text-sm font-medium text-slate-300">Password</label><input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg shadow-sm text-white focus:ring-indigo-500 focus:border-indigo-500" placeholder="••••••••" /></div>
                    {!isLogin && (<><div><label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300">Confirm Password</label><input id="confirmPassword" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-1 block w-full px-4 py-2 bg-slate-900 border border-slate-600 rounded-lg shadow-sm text-white focus:ring-indigo-500 focus:border-indigo-500" placeholder="••••••••" /></div><div><label className="block text-sm font-medium text-slate-300 mb-2">I am a:</label><div className="flex space-x-2 bg-slate-900 p-1 rounded-lg"><label className={`w-1/2 text-center p-2 rounded-md cursor-pointer transition-colors ${userType === 'student' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}><input type="radio" className="sr-only" name="userType" value="student" checked={userType === 'student'} onChange={() => setUserType('student')} />Student</label><label className={`w-1/2 text-center p-2 rounded-md cursor-pointer transition-colors ${userType === 'landlord' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}><input type="radio" className="sr-only" name="userType" value="landlord" checked={userType === 'landlord'} onChange={() => setUserType('landlord')} />Landlord</label></div></div></>)}
                    <button type="submit" disabled={loading} className="w-full bg-indigo-600 text-white py-2.5 rounded-lg hover:bg-indigo-500 transition disabled:bg-indigo-800 disabled:cursor-not-allowed font-semibold">{loading ? "Processing..." : (isLogin ? "Login" : "Sign Up")}</button>
                </form>
                <p className="mt-6 text-center text-sm text-slate-400">{isLogin ? "Don't have an account? " : "Already have an account? "}<Link to={isLogin ? "/signup" : "/login"} className="text-indigo-400 hover:text-indigo-300 font-semibold">{isLogin ? "Sign Up" : "Login"}</Link></p>
            </div>
        </div>
    );
};


// --- MAIN APP ROUTER ---
const AppRoutes = () => {
    const { currentUser } = useAuth();
    return (
        <Routes>
            <Route path="/" element={<DashboardLayout />}>
                <Route index element={<DashboardView />} />
                <Route path="properties" element={<PropertiesView />} />
                <Route path="add-property" element={<AddPropertyView />} />
                <Route path="edit-property/:propertyId" element={<EditPropertyView />} />
                <Route path="properties/:propertyId" element={<PropertyDetailsView />} />
                
                {currentUser?.userType === 'student' ? (
                    <Route path="favorites" element={<FavoritesView />} />
                ) : (
                    <Route path="my-properties" element={<PropertiesView />} />
                )}

                <Route path="messages" element={<MessagesView />} />
                <Route path="messages/:conversationId" element={<MessagesView />} />
                <Route path="profile" element={<ProfileView />} />
            </Route>
            <Route path="/login" element={<AuthForm isLogin />} />
            <Route path="/signup" element={<AuthForm isLogin={false} />} />
        </Routes>
    );
}

export default function App() {
    return (
        <AuthProvider>
            <SearchProvider>
                <FilterProvider>
                    <WebSocketProvider>
                        <BrowserRouter>
                            <Toaster position="bottom-center" toastOptions={{ style: { background: '#334155', color: '#fff' } }} />
                            <AppRoutes />
                        </BrowserRouter>
                    </WebSocketProvider>
                </FilterProvider>
            </SearchProvider>
        </AuthProvider>
    );
}