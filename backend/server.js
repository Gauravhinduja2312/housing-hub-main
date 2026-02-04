require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const bodyParser = require('body-parser');
const cors = require('cors'); // <-- Correctly required
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose');
const fetch = require('node-fetch');

// --- Database Connection ---
const connectDB = async () => {
    if (!process.env.MONGO_URI) {
        console.error('FATAL ERROR: MONGO_URI is not defined in the environment variables.');
        process.exit(1);
    }
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected successfully.');
    } catch (err) {
        console.error('MongoDB connection error:', err.message);
        process.exit(1);
    }
};

const app = express();
connectDB();

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-change-this";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --- APPLICATION SCHEMA ---
const ApplicationSchema = new mongoose.Schema({
    property_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    landlord_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    message: { type: String, default: '' }, // Student's note
}, { timestamps: true });

const Application = mongoose.model('Application', ApplicationSchema);

// --- Mongoose Schemas ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    
    // I added 'admin' here so you can verify people later
    user_type: { 
        type: String, 
        enum: ['student', 'landlord', 'admin'], 
        required: true 
    },
    
    profilePictureUrl: { type: String, default: '' },
    bio: { type: String, default: '', maxLength: 250 },

    // --- NEW VERIFICATION FIELDS (Start) ---
    isVerified: { 
        type: Boolean, 
        default: false 
    },
    verificationStatus: {
        type: String,
        enum: ['none', 'pending', 'approved', 'rejected'],
        default: 'none'
    },
    verificationDocument: { 
        type: String, 
        default: '' // We will save the image URL here later
    },
    // --- NEW VERIFICATION FIELDS (End) ---

}, { timestamps: true });

const PropertySchema = new mongoose.Schema({
    landlord_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    description: String,
    address: { type: String, required: true },
    city: { type: String, required: true },
    price: { type: Number, required: true },
    property_type: { type: String, enum: ['apartment', 'house', 'room'], required: true },
    bedrooms: Number,
    bathrooms: Number,
    amenities: String,
    image_url: String,
    images: [String],
    lat: { type: Number },
    lng: { type: Number },
    virtual_tour_url: { type: String, default: '' },
}, { timestamps: true });

const FavoriteSchema = new mongoose.Schema({ user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, property_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true }, }, { timestamps: true });
FavoriteSchema.index({ user_id: 1, property_id: 1 }, { unique: true });
const ConversationSchema = new mongoose.Schema({ property_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true }, student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, landlord_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, }, { timestamps: true });
const MessageSchema = new mongoose.Schema({ conversation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true }, sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, content: { type: String, required: true }, }, { timestamps: true });
const PropertyViewSchema = new mongoose.Schema({ property_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true }, }, { timestamps: true });
const NotificationSchema = new mongoose.Schema({ recipient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, message: { type: String, required: true }, link: { type: String }, isRead: { type: Boolean, default: false }, }, { timestamps: true });
const ReviewSchema = new mongoose.Schema({
    property_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, maxLength: 1000 },
}, { timestamps: true });
ReviewSchema.index({ property_id: 1, user_id: 1 }, { unique: true });

// --- Mongoose Models ---
const User = mongoose.model('User', UserSchema);
const Property = mongoose.model('Property', PropertySchema);
const Favorite = mongoose.model('Favorite', FavoriteSchema);
const Conversation = mongoose.model('Conversation', ConversationSchema);
const Message = mongoose.model('Message', MessageSchema);
const PropertyView = mongoose.model('PropertyView', PropertyViewSchema);
const Notification = mongoose.model('Notification', NotificationSchema);
const Review = mongoose.model('Review', ReviewSchema);

// --- Middleware & Config ---
cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ⬇️ THIS IS THE SECURE CORS CONFIGURATION ⬇️
const corsOptions = {
    origin: [
        'https://housing-hub-frontend-main.onrender.com', // Your deployed frontend
        'http://localhost:3000'                           // Your local dev frontend
    ],
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
// ⬆️ This replaces your old 'app.use(cors())' ⬆️

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
// Allow up to 10MB so users can upload images
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ limit: '10mb', extended: true })); // This was in your original file, good to have.

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- WebSocket Server Logic ---
const clients = new Map();
wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'auth' && data.token) {
                jwt.verify(data.token, JWT_SECRET, (err, user) => {
                    if (!err && user) {
                        clients.set(user.userId, ws);
                        ws.userId = user.userId;
                        ws.userType = user.userType;
                        console.log(`User ${ws.userId} (${ws.userType}) connected via WebSocket.`);
                    } else { ws.close(); }
                });
            } else if (data.type === 'message' && ws.userId) {
                const { conversation_id, content } = data.payload;
                const conversation = await Conversation.findById(conversation_id);
                if (!conversation) return;

                const newMessage = new Message({ conversation_id, sender_id: ws.userId, content });
                await newMessage.save();

                const recipientId = String(conversation.student_id) === ws.userId 
                    ? String(conversation.landlord_id) 
                    : String(conversation.student_id);
                
                const senderId = ws.userId;

                // Send new message to both parties in the conversation
                [senderId, recipientId].forEach(id => {
                    const clientWs = clients.get(id);
                    if (clientWs && clientWs.readyState === ws.OPEN) {
                        clientWs.send(JSON.stringify({ type: 'newMessage', payload: newMessage }));
                    }
                });
                
                // Simplified bot reply logic, main logic moved to API
                if (ws.userType === 'student' && content.toLowerCase().includes('help')) {
                    setTimeout(async () => {
                        const botMessage = new Message({
                            conversation_id,
                            sender_id: conversation.landlord_id,
                            content: "This is an automated reply. The landlord will get back to you soon. For quick questions about the property, try the 'Ask AI' button!",
                        });
                        await botMessage.save();
                        [senderId, recipientId].forEach(id => {
                            const clientWs = clients.get(id);
                            if (clientWs && clientWs.readyState === ws.OPEN) {
                                clientWs.send(JSON.stringify({ type: 'newMessage', payload: botMessage }));
                            }
                        });
                    }, 1500);
                }
            }
        } catch (error) { console.error('WebSocket error:', error); }
    });
    ws.on('close', () => { if(ws.userId) { clients.delete(ws.userId); } });
});


// --- REST API Routes ---
app.post('/api/signup', async (req, res) => {
    const { email, password, userType, username } = req.body;
    try {
        let existingUser = await User.findOne({ email });
        if (existingUser) return res.status(409).json({ message: 'Email already registered.' });
        existingUser = await User.findOne({ username });
        if (existingUser) return res.status(409).json({ message: 'Username is already taken.' });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email, password: hashedPassword, user_type: userType });
        await newUser.save();

        const token = jwt.sign({ userId: newUser._id, username: newUser.username, userType: newUser.user_type }, JWT_SECRET, { expiresIn: "1h" });
        
        res.status(201).json({ token, userId: newUser._id, userType: newUser.user_type, username: newUser.username, email: newUser.email, profilePictureUrl: newUser.profilePictureUrl, bio: newUser.bio });
    } catch (error) { res.status(500).json({ message: 'Server error during signup.' }); }
});

// --- VERIFICATION ROUTE ---

// Landlord uploads ID proof
app.post('/api/upload-verification', async (req, res) => {
    try {
        const { userId, documentImage } = req.body;

        if (!userId || !documentImage) {
            return res.status(400).json({ message: "Missing user ID or document" });
        }

        // Find the user and update their status
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            {
                verificationStatus: 'pending',   // Change status to 'Pending'
                verificationDocument: documentImage // Save the image string
            },
            { new: true } // Return the updated user
        );

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json({ 
            message: "Verification submitted successfully! Please wait for Admin approval.", 
            user: updatedUser 
        });

    } catch (error) {
        console.error("Verification Error:", error);
        res.status(500).json({ message: "Server error during upload" });
    }
});

app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: "Invalid email or password." });
        }
        const token = jwt.sign({ userId: user._id, username: user.username, userType: user.user_type }, JWT_SECRET, { expiresIn: "1h" });
        res.json({ token, userId: user._id, userType: user.user_type, username: user.username, email: user.email, profilePictureUrl: user.profilePictureUrl, bio: user.bio,isVerified: user.isVerified,
    verificationStatus: user.verificationStatus});
    } catch (err) { res.status(500).json({ message: "Server error." }); }
});

app.get('/api/properties', async (req, res) => {
    try {
        const { search, page = 1, limit = 6, city, minPrice, maxPrice, bedrooms, propertyType } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        let query = {};
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } },
                { city: { $regex: search, $options: 'i' } }
            ];
        }
        if (city && city !== 'All') query.city = city;
        if (minPrice || maxPrice) {
            query.price = {};
            if (minPrice) query.price.$gte = parseInt(minPrice);
            if (maxPrice) query.price.$lte = parseInt(maxPrice);
        }
        if (bedrooms && bedrooms !== 'Any') {
             if (bedrooms === '4+') { query.bedrooms = { $gte: 4 }; } 
             else { query.bedrooms = parseInt(bedrooms); }
        }
        if (propertyType && propertyType !== 'All') query.property_type = propertyType;

        const properties = await Property.aggregate([
            { $match: query },
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limitNum },
            {
                $lookup: {
                    from: 'reviews',
                    localField: '_id',
                    foreignField: 'property_id',
                    as: 'reviews'
                }
            },
            {
                $addFields: {
                    averageRating: { $avg: '$reviews.rating' },
                    reviewCount: { $size: '$reviews' }
                }
            },
            { $project: { reviews: 0 } }
        ]);

        const totalProperties = await Property.countDocuments(query);
        const totalPages = Math.ceil(totalProperties / limitNum);

        res.json({
            properties,
            currentPage: pageNum,
            totalPages,
        });
    } catch (error) {
        console.error("Error fetching properties:", error);
        res.status(500).json({ message: 'Server error fetching properties.' });
    }
});

app.get('/api/properties/featured', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 3;
        const popularProperties = await Favorite.aggregate([
            { $group: { _id: '$property_id', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: limit },
            { $lookup: { from: 'properties', localField: '_id', foreignField: '_id', as: 'propertyDetails' } },
            { $unwind: '$propertyDetails' },
            { $replaceRoot: { newRoot: '$propertyDetails' } }
        ]);

        if (popularProperties.length < limit) {
            const recentProperties = await Property.find({
                _id: { $nin: popularProperties.map(p => p._id) }
            }).sort({ createdAt: -1 }).limit(limit - popularProperties.length);
            res.json([...popularProperties, ...recentProperties]);
        } else {
            res.json(popularProperties);
        }
    } catch (error) {
        res.status(500).json({ message: 'Server error fetching featured properties.' });
    }
});

app.get('/api/properties/cities', async (req, res) => {
    try {
        const cities = await Property.distinct('city');
        res.json(cities);
    } catch (error) {
        res.status(500).json({ message: 'Server error fetching cities.' });
    }
});

app.get('/api/properties/:id', async (req, res) => {
    try {
        const property = await Property.findById(req.params.id);
        if (!property) return res.status(404).json({ message: 'Property not found' });
        res.json(property);
    } catch (error) {
        res.status(500).json({ message: 'Server error fetching property' });
    }
});

app.post('/api/properties', authenticateToken, upload.array('images', 5), async (req, res) => {
    try { 
        const user = await User.findById(req.user.userId);

        // 2. THE GATEKEEPER CHECK
        if (user.userType === 'landlord' && !user.isVerified) {
            return res.status(403).json({ 
                message: "⛔ Access Denied: You must be a Verified Landlord to post properties. Please upload your ID in the Profile section." 
            });
        }

        let imageUrls = [];
        if (req.files) {
            for(const file of req.files) {
                const result = await new Promise((resolve, reject) => {
                    const uploadStream = cloudinary.uploader.upload_stream({ folder: 'housing_hub_properties' }, (error, result) => {
                        if (error) reject(error);
                        else resolve(result);
                    });
                    uploadStream.end(file.buffer);
                });
                imageUrls.push(result.secure_url);
            }
        }
        const newProperty = new Property({ 
            ...req.body, 
            image_url: imageUrls[0] || '',
            images: imageUrls,
            landlord_id: req.user.userId,
            lat: req.body.lat || null,
            lng: req.body.lng || null,
            virtual_tour_url: req.body.virtual_tour_url || ''
        });
        await newProperty.save();
        res.status(201).json(newProperty);
    } catch (error) {
        res.status(500).json({ message: 'Server error adding property' });
    }
});

app.put('/api/properties/:id', authenticateToken, async (req, res) => {
    try {
        const property = await Property.findById(req.params.id);
        if (!property) return res.status(404).json({ message: 'Property not found' });
        if (property.landlord_id.toString() !== req.user.userId) return res.status(403).json({ message: 'User not authorized' });
        
        const updatedData = { ...req.body };
        const updatedProperty = await Property.findByIdAndUpdate(req.params.id, updatedData, { new: true });
        res.json(updatedProperty);
    } catch (error) {
        res.status(500).json({ message: 'Server error updating property' });
    }
});

app.delete('/api/properties/:id', authenticateToken, async (req, res) => {
    try {
        const property = await Property.findById(req.params.id);
        if (!property) return res.status(404).json({ message: 'Property not found' });
        if (property.landlord_id.toString() !== req.user.userId) return res.status(403).json({ message: 'User not authorized' });

        await Property.findByIdAndDelete(req.params.id);
        res.json({ message: 'Property removed' });
    } catch (error) {
        res.status(500).json({ message: 'Server error deleting property' });
    }
});

app.post('/api/properties/:propertyId/view', async (req, res) => {
    try {
        await PropertyView.create({ property_id: req.params.propertyId });
        res.status(200).json({ message: 'View recorded.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error recording view.' });
    }
});

app.get('/api/favorites', authenticateToken, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit);
        let query = Favorite.find({ user_id: req.user.userId }).populate('property_id').sort({ createdAt: -1 });
        if(limit) {
            query = query.limit(limit);
        }
        const favorites = await query;
        res.json(favorites.map(fav => fav.property_id).filter(p => p));
    } catch (error) {
        res.status(500).json({ message: 'Server error fetching favorites.' });
    }
});

app.post('/api/favorites', authenticateToken, async (req, res) => {
    const { property_id } = req.body;
    const { userId } = req.user;
    try {
        const favorite = new Favorite({ user_id: userId, property_id });
        await favorite.save();
        
        const property = await Property.findById(property_id);
        if (property && String(property.landlord_id) !== userId) {
            const notification = new Notification({
                recipient_id: property.landlord_id,
                sender_id: userId,
                message: `Your property '${property.title}' has a new favorite!`,
                link: `/properties/${property_id}`
            });
            await notification.save();
            
            const landlordWs = clients.get(String(property.landlord_id));
            if (landlordWs && landlordWs.readyState === 1) {
                landlordWs.send(JSON.stringify({ type: 'newNotification', payload: notification }));
            }
        }
        res.status(201).json(favorite);
    } catch (err) {
        res.status(500).json({ message: "Error adding favorite" });
    }
});

app.delete('/api/favorites/:propertyId', authenticateToken, async (req, res) => {
    try {
        await Favorite.findOneAndDelete({ user_id: req.user.userId, property_id: req.params.propertyId });
        res.json({ message: 'Favorite removed' });
    } catch (err) {
        res.status(500).json({ message: "Error removing favorite" });
    }
});

app.get('/api/conversations', authenticateToken, async (req, res) => {
    try {
        const conversations = await Conversation.find({ $or: [{ student_id: req.user.userId }, { landlord_id: req.user.userId }]})
            .populate('student_id', 'username email')
            .populate('landlord_id', 'username email')
            .populate('property_id', 'title');
        res.json(conversations);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching conversations' });
    }
});

app.post('/api/conversations', authenticateToken, async (req, res) => {
    const { property_id, landlord_id } = req.body;
    const student_id = req.user.userId;

    try {
        let convo = await Conversation.findOne({ property_id, student_id });
        if (convo) {
            return res.status(200).json({ conversationId: convo._id });
        }
        const newConvo = new Conversation({ property_id, student_id, landlord_id });
        await newConvo.save();
        res.status(201).json({ conversationId: newConvo._id });
    } catch (error) {
        console.error("Conversation creation error:", error);
        res.status(500).json({ message: 'Server error starting conversation.' });
    }
});

app.get('/api/conversations/:id/messages', authenticateToken, async (req, res) => {
    try {
        const convo = await Conversation.findOne({ _id: req.params.id, $or: [{ student_id: req.user.userId }, { landlord_id: req.user.userId }] });
        if (!convo) return res.status(403).json({ message: 'Unauthorized.' });
        const messages = await Message.find({ conversation_id: req.params.id }).sort({ createdAt: 'asc' });
        res.json(messages);
    } catch (error) {
        res.status(500).json({ message: 'Server error fetching messages.' });
    }
});

// --- REVIEW ROUTES ---
app.get('/api/properties/:propertyId/reviews', async (req, res) => {
    try {
        const reviews = await Review.find({ property_id: req.params.propertyId })
            .populate('user_id', 'username profilePictureUrl')
            .sort({ createdAt: -1 });
        res.json(reviews);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching reviews.' });
    }
});

app.post('/api/properties/:propertyId/reviews', authenticateToken, async (req, res) => {
    const { rating, comment } = req.body;
    const { propertyId } = req.params;
    const { userId, userType } = req.user;

    if (userType !== 'student') {
        return res.status(403).json({ message: 'Only students can leave reviews.' });
    }
    if (!rating || !comment) {
        return res.status(400).json({ message: 'Rating and comment are required.' });
    }

    try {
        const newReview = new Review({
            property_id: propertyId,
            user_id: userId,
            rating,
            comment
        });
        await newReview.save();
        
        const populatedReview = await Review.findById(newReview._id).populate('user_id', 'username profilePictureUrl');
        
        res.status(201).json(populatedReview);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: 'You have already reviewed this property.' });
        }
        res.status(500).json({ message: 'Server error posting review.' });
    }
});

app.get('/api/properties/:propertyId/reviews/summary', async (req, res) => {
    try {
        const reviews = await Review.find({ property_id: req.params.propertyId });
        if (reviews.length < 2) {
            return res.json({ summary: "Not enough reviews to generate a summary." });
        }

        if (!GEMINI_API_KEY) {
            console.error("GEMINI_API_KEY is not defined.");
            return res.status(500).json({ message: "AI service is not configured." });
        }

        const reviewText = reviews.map(r => r.comment).join("\n\n");
        const model = "gemini-2.5-flash-preview-09-2025";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        const systemPrompt = "You are a helpful assistant. Summarize the following property reviews into 3-5 concise bullet points, highlighting the main pros and cons. Start with 'Pros:' and 'Cons:'.";
        const userQuery = `Reviews:\n${reviewText}`;

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('AI call failed');
        
        const result = await response.json();
        const summary = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (summary) {
            res.json({ summary });
        } else {
            res.status(500).json({ message: "Could not generate summary." });
        }
    } catch (error) {
        console.error("AI summary error:", error);
        res.status(500).json({ message: "Server error generating summary." });
    }
});


// --- PROFILE ROUTES ---
app.get('/api/profile/stats', authenticateToken, async (req, res) => {
    try {
        const { userId, userType } = req.user;
        const userObjectId = new mongoose.Types.ObjectId(userId);
        let stats = {};

        if (userType === 'student') {
            stats.favoritesCount = await Favorite.countDocuments({ user_id: userObjectId });
            stats.conversationsCount = await Conversation.countDocuments({ student_id: userObjectId });
        } else if (userType === 'landlord') {
            stats.propertiesCount = await Property.countDocuments({ landlord_id: userObjectId });
            stats.conversationsCount = await Conversation.countDocuments({ landlord_id: userObjectId });
        }

        res.json(stats);
    } catch (error) {
        console.error("Profile stats error:", error);
        res.status(500).json({ message: 'Server error fetching profile stats.' });
    }
});

app.post('/api/profile/change-password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const { userId } = req.user;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Incorrect current password.' });
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await User.updateOne({ _id: userId }, { $set: { password: hashedNewPassword } });

        res.json({ message: 'Password updated successfully!' });
    } catch (error) {
        console.error("Change password error:", error);
        res.status(500).json({ message: 'Server error changing password.' });
    }
});

app.put('/api/profile/update-username', authenticateToken, async (req, res) => {
    const { newUsername } = req.body;
    const { userId } = req.user;

    if (!newUsername || newUsername.trim() === '') {
        return res.status(400).json({ message: 'Username cannot be empty.' });
    }

    try {
        const existingUser = await User.findOne({ username: newUsername, _id: { $ne: userId } });
        if (existingUser) {
            return res.status(409).json({ message: 'Username is already taken.' });
        }

        await User.updateOne({ _id: userId }, { $set: { username: newUsername } });
        
        const updatedUser = await User.findById(userId);

        const newToken = jwt.sign({ userId: updatedUser._id, username: updatedUser.username, userType: updatedUser.user_type }, JWT_SECRET, { expiresIn: "1h" });

        res.json({ 
            message: 'Username updated successfully!', 
            newUsername: updatedUser.username,
            token: newToken 
        });
    } catch (error) {
        console.error("Update username error:", error);
        res.status(500).json({ message: 'Server error updating username.' });
    }
});

app.put('/api/profile/upload-picture', authenticateToken, upload.single('profilePicture'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }

    try {
        const result = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream({ folder: 'housing_hub_profiles' }, (error, result) => {
                if (error) reject(error);
                else resolve(result);
            });
            uploadStream.end(req.file.buffer);
        });

        const profilePictureUrl = result.secure_url;

        await User.updateOne({ _id: req.user.userId }, { $set: { profilePictureUrl } });

        res.json({
            message: 'Profile picture updated successfully!',
            profilePictureUrl,
        });
    } catch (error) {
        console.error("Profile picture upload error:", error);
        res.status(500).json({ message: 'Server error uploading profile picture.' });
    }
});

app.put('/api/profile/update-bio', authenticateToken, async (req, res) => {
    const { bio } = req.body;
    const { userId } = req.user;

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }
        user.bio = bio;
        await user.save();
        res.json({ message: 'Bio updated successfully!', bio: user.bio });
    } catch (error) {
        res.status(500).json({ message: 'Server error updating bio.' });
    }
});

app.post('/api/profile/delete-account', authenticateToken, async (req, res) => {
    const { password } = req.body;
    const { userId, userType } = req.user;

    if (!password) {
        return res.status(400).json({ message: 'Password is required for deletion.' });
    }
    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Incorrect password.' });

        if (userType === 'landlord') {
            const properties = await Property.find({ landlord_id: userId });
            const propertyIds = properties.map(p => p._id);

            await Property.deleteMany({ landlord_id: userId });
            await Favorite.deleteMany({ property_id: { $in: propertyIds } });
            await Conversation.deleteMany({ property_id: { $in: propertyIds } });
            await PropertyView.deleteMany({ property_id: { $in: propertyIds } });
        }
        else if (userType === 'student') {
            await Favorite.deleteMany({ user_id: userId });
            await Conversation.deleteMany({ student_id: userId });
        }

        await User.findByIdAndDelete(userId);

        res.json({ message: 'Your account has been permanently deleted.' });
    } catch (error) {
        console.error("Account deletion error:", error);
        res.status(500).json({ message: 'Server error deleting account.' });
    }
});

// --- DASHBOARD & NOTIFICATION ROUTES ---
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    if (req.user.userType !== 'landlord') {
        return res.status(403).json({ message: 'Access denied.' });
    }
    try {
        const landlordId = new mongoose.Types.ObjectId(req.user.userId);
        
        const properties = await Property.find({ landlord_id: landlordId }).select('_id title');
        const propertyIds = properties.map(p => p._id);

        const summary = {
            totalProperties: properties.length,
            totalViews: await PropertyView.countDocuments({ property_id: { $in: propertyIds } }),
            totalFavorites: await Favorite.countDocuments({ property_id: { $in: propertyIds } }),
            totalConversations: await Conversation.countDocuments({ landlord_id: landlordId })
        };

        const propertyStats = await Promise.all(properties.map(async (prop) => ({
            _id: prop._id,
            title: prop.title,
            view_count: await PropertyView.countDocuments({ property_id: prop._id }),
        })));

        res.json({ summary, properties: propertyStats });
    } catch (error) {
        res.status(500).json({ message: 'Server error fetching dashboard stats.' });
    }
});

app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const notifications = await Notification.find({ recipient_id: req.user.userId })
            .sort({ createdAt: -1 })
            .limit(20);
        res.json(notifications);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching notifications' });
    }
});

app.put('/api/notifications/mark-read', authenticateToken, async (req, res) => {
    try {
        await Notification.updateMany({ recipient_id: req.user.userId, isRead: false }, { $set: { isRead: true } });
        res.json({ message: 'All notifications marked as read.' });
    } catch (error) {
        res.status(500).json({ message: 'Error updating notifications' });
    }
});

// --- AI FEATURE ROUTES ---
app.post('/api/properties/generate-description', authenticateToken, async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
        return res.status(400).json({ message: "Prompt (keywords) is required." });
    }

    if (!GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY is not defined in .env file.");
        return res.status(500).json({ message: "Server error: AI service is not configured." });
    }

    const model = "gemini-2.5-flash-preview-09-2025";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    const systemPrompt = "You are a real estate agent. Write a compelling, one-paragraph property description based on the following keywords. Be descriptive and persuasive, but do not make up facts not implied by the keywords.";
    const userQuery = `Keywords: ${prompt}`;

    try {
        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.json();
            console.error("Gemini API Error:", errorBody);
            throw new Error(`API call failed with status: ${response.status}`);
        }

        const result = await response.json();
        const description = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (description) {
            res.json({ description });
        } else {
            res.status(500).json({ message: "Could not generate description from AI." });
        }
    } catch (error) {
        console.error("AI description error:", error);
        res.status(500).json({ message: "Server error generating description." });
    }
});

app.post('/api/conversations/:id/ask-ai', authenticateToken, async (req, res) => {
    const { question } = req.body;
    const { id } = req.params;

    if (!question) {
        return res.status(400).json({ message: "A question is required." });
    }
    if (!GEMINI_API_KEY) {
        return res.status(500).json({ message: "AI service is not configured." });
    }

    try {
        const conversation = await Conversation.findById(id).populate('property_id');
        if (!conversation) {
            return res.status(404).json({ message: "Conversation not found." });
        }
        
        const property = conversation.property_id;
        if (!property) {
            return res.status(404).json({ message: "Property not found for this conversation." });
        }

        const context = `
            Property Title: ${property.title}
            Description: ${property.description}
            City: ${property.city}
            Address: ${property.address}
            Price: ₹${property.price}/month
            Bedrooms: ${property.bedrooms || 'Not specified'}
            Bathrooms: ${property.bathrooms || 'Not specified'}
            Amenities: ${property.amenities || 'Not specified'}
        `;

        const model = "gemini-2.5-flash-preview-09-2025";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        
        const systemPrompt = `You are a friendly and helpful AI assistant for a property rental website called Housing Hub. A user is asking a question about a specific property.
Your primary goal is to answer questions based *only* on the provided property 'Context'.

Here are the rules:
1.  **Answer from Context:** If the answer is in the 'Context', answer it directly and politely.
2.  **No Information:** If the answer is *not* in the 'Context' (e.g., the user asks about 'pets' but the amenities list doesn't mention it), you MUST say: "I do not have that specific information in my records. The landlord has been notified and will get back to you soon about that."
3.  **General Chit-Chat:** If the user is just saying 'hi' or 'hello', respond with a simple, friendly greeting.
4.  **Handle 'help':** If the user asks for 'help', you can say: "Hi! I'm an AI assistant. You can ask me specific questions about this property, like 'What is the price?' or 'Does it have a kitchen?'. For other matters, the landlord will reply to you directly."
5.  **Do not make up information** that is not in the context.
6.  Start your response directly without "As an AI assistant...".`;
        
        const userQuery = `Context:\n${context}\n\nQuestion:\n${question}`;

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('AI call failed');

        const result = await response.json();
        const answer = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (answer) {
            const botMessage = new Message({
                conversation_id: id,
                sender_id: conversation.landlord_id,
                content: answer,
            });
            await botMessage.save();

            [String(conversation.student_id), String(conversation.landlord_id)].forEach(userId => {
                const clientWs = clients.get(userId);
                if (clientWs && clientWs.readyState === 1) {
                    clientWs.send(JSON.stringify({ type: 'newMessage', payload: botMessage }));
                }
            });

            res.json({ message: "AI response sent." });
        } else {
            res.status(500).json({ message: "Could not get an answer from AI." });
        }
    } catch (error) {
        console.error("AI chat error:", error);
        res.status(500).json({ message: "Server error processing AI request." });
    }
});

// --- ADMIN ROUTES ---

// 1. Get all pending verification requests
app.get('/api/admin/verifications', async (req, res) => {
    try {
        // Fetch all users who are waiting for approval
        const pendingUsers = await User.find({ verificationStatus: 'pending' });
        res.json(pendingUsers);
    } catch (error) {
        res.status(500).json({ message: "Error fetching requests" });
    }
});

// 2. Approve or Reject a Landlord
app.post('/api/admin/verify-action', async (req, res) => {
    try {
        const { userId, action } = req.body; // action will be 'approve' or 'reject'

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ message: "Invalid action" });
        }

        const status = action === 'approve' ? 'approved' : 'rejected';
        const isVerified = action === 'approve'; // True only if approved

        const updatedUser = await User.findByIdAndUpdate(userId, {
            verificationStatus: status,
            isVerified: isVerified
        }, { new: true });

        res.json({ message: `User ${status} successfully!`, user: updatedUser });

    } catch (error) {
        res.status(500).json({ message: "Error updating status" });
    }
});

// --- APPLICATION ROUTES ---

// 1. Student: Apply for a property
app.post('/api/applications', requireAuth, async (req, res) => {
    try {
        const { property_id, landlord_id, message } = req.body;

        // Prevent double application
        const existing = await Application.findOne({ property_id, student_id: req.user.userId });
        if (existing) return res.status(400).json({ message: "You have already applied here!" });

        const newApp = new Application({
            property_id,
            landlord_id,
            student_id: req.user.userId,
            message
        });
        await newApp.save();
        res.json(newApp);
    } catch (error) {
        res.status(500).json({ message: "Application failed" });
    }
});

// 2. Student: See my applications
app.get('/api/applications/student', requireAuth, async (req, res) => {
    try {
        const apps = await Application.find({ student_id: req.user.userId })
            .populate('property_id') // Get property details
            .populate('landlord_id', 'username email'); // Get landlord info
        res.json(apps);
    } catch (error) {
        res.status(500).json({ message: "Error fetching applications" });
    }
});

// 3. Landlord: See who applied to my properties
app.get('/api/applications/landlord', requireAuth, async (req, res) => {
    try {
        const apps = await Application.find({ landlord_id: req.user.userId })
            .populate('student_id', 'username email profilePictureUrl bio') // Get student profile
            .populate('property_id', 'title'); // Get property title
        res.json(apps);
    } catch (error) {
        res.status(500).json({ message: "Error fetching applications" });
    }
});

// 4. Landlord: Accept or Reject
app.post('/api/applications/:id/status', requireAuth, async (req, res) => {
    try {
        const { status } = req.body; // 'accepted' or 'rejected'
        const updatedApp = await Application.findByIdAndUpdate(
            req.params.id, 
            { status }, 
            { new: true }
        );
        res.json(updatedApp);
    } catch (error) {
        res.status(500).json({ message: "Update failed" });
    }
});

server.listen(PORT, () => {
    console.log(`Backend server with WebSocket running on http://localhost:${PORT}`);
});