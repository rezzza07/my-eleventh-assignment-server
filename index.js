const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const port = process.env.PORT || 3000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const crypto = require('crypto');
const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
function generateOrderTraceId() {
    const prefix = 'ORDR';
    const date = new Date()
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, '');
    const random = crypto
        .randomBytes(5)
        .toString('base64')
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 8);
    return `${prefix}-${date}-${random}`;
}

// middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
    }
    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        req.decoded_email = decoded.email;
        next();
    }
    catch (err) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

}
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ilappos.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();
        const db = client.db("book_courier_db");
        const userCollection = db.collection('users');
        const booksCollection = db.collection('books');
        const coverageCollection = db.collection('coverage');
        const courierCollection = db.collection('courier');
        const paymentCollection = db.collection('payments');
        const librarianCollection = db.collection('librarian');
        const ordersCollection = db.collection('orders');
        const wishlistCollection = db.collection('wishlists');



        // Admin Verification
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await userCollection.findOne(query);

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: ' forbidden access' });
            }

            next();
        }

        // User related APIs
        app.get('/users', verifyFBToken, async (req, res) => {
            const { searchText } = req.query;

            let query = {};

            if (searchText) {
                query = {
                    $or: [
                        { displayName: { $regex: searchText, $options: 'i' } },
                        { email: { $regex: searchText, $options: 'i' } }
                    ]
                };
            }

            const result = await userCollection
                .find(query)
                .sort({ createdAt: -1 })
                .limit(10)
                .toArray();

            res.send(result);
        });


        app.get('/users/:id', async (req, res) => {

        })

        app.get('/users/:email/role', async (req, res) => {
            const email = req.params.email;
            const query = { email };

            const user = await userCollection.findOne(query);
            res.send({ role: user?.role || 'user' });
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = 'user';
            user.createdAt = new Date();

            const email = user.email;
            const userExists = await userCollection.findOne({ email })

            if (userExists) {
                return res.send({ message: 'user exists' })
            }

            const result = await userCollection.insertOne(user);
            res.send(result);
        });






        // Books API
        app.get('/books', async (req, res) => {
            const query = {};

            const cursor = booksCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        })

        // Latest Books
        app.get('/latest-books', async (req, res) => {

            const result = await booksCollection.find({}).sort({ createdAt: -1 }).limit(6).toArray();
            res.send(result);

        });

        // Book Details
        app.get('/books/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const result = await booksCollection.findOne(query);
            res.send(result);
        });

        // Coverage
        app.get('/coverage', async (req, res) => {
            const query = {};

            const cursor = coverageCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        })


        // Add a book***********
        app.post('/my-books', verifyFBToken, async (req, res) => {
            const book = req.body;
            book.createdAt = new Date();
            book.addedBy = req.decoded_email;

            const result = await booksCollection.insertOne(book);
            res.send({
                success: true,
                message: 'Book added successfully',
                bookId: result.insertedId
            });
        });

        // Get all books added by the logged-in librarian*************
        app.get('/my-books', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const books = await booksCollection.find({ addedBy: email }).toArray();
            res.send(books);
        });

        app.get('/my-books/:id', verifyFBToken, async (req, res) => {
            const { id } = req.params;
            const email = req.decoded_email;

            try {
                const book = await booksCollection.findOne({ _id: new ObjectId(id), addedBy: email });
                if (!book) {
                    return res.status(404).send({ message: 'Book not found' });
                }
                res.send(book);
            } catch (error) {
                res.status(500).send({ message: 'Server error' });
            }
        });


        // Create an order
        app.post('/orders', verifyFBToken, async (req, res) => {
            const { bookId, buyerEmail, price, bookName, bookImage } = req.body;

            if (!ObjectId.isValid(bookId))
                return res.status(400).send({ success: false, message: 'Invalid book ID' });

            const order = {
                bookId,
                bookName,
                bookImage,
                buyerEmail,
                price,
                status: 'pending',
                paymentStatus: 'unpaid',
                createdAt: new Date()
            };

            const result = await ordersCollection.insertOne(order);
            res.send({ success: true, orderId: result.insertedId });
        });


        // Update a book by id************
        app.patch('/my-books/:id', verifyFBToken, async (req, res) => {
            const { id } = req.params;
            const email = req.decoded_email;

            const { name, author, image, price, status, description } = req.body;

            if (!['published', 'unpublished'].includes(status)) {
                return res.status(400).send({ message: 'Invalid status' });
            }

            const result = await booksCollection.updateOne(
                { _id: new ObjectId(id), addedBy: email },
                {
                    $set: {
                        name,
                        author,
                        image,
                        price,
                        description, 
                        status,
                        updatedAt: new Date(),
                    },
                }
            );

            if (result.matchedCount === 0) {
                return res.status(403).send({ message: 'Unauthorized' });
            }

            res.send({ success: true });
        });


        app.get('/librarian/orders', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const books = await booksCollection.find({ addedBy: email }).toArray();
            const bookIds = books.map(b => b._id.toString());
            const orders = await ordersCollection.find({ bookId: { $in: bookIds } }).toArray();
            res.send(orders);
        });





        // ----------------------
        // Get all orders for librarian's books
        // ----------------------
        app.get('/librarian/orders', verifyFBToken, async (req, res) => {
            try {
                const email = req.decoded_email;

                // Get all books added by this librarian
                const books = await booksCollection.find({ addedBy: email }).toArray();
                const bookIds = books.map(b => b._id.toString());

                // Fetch orders for these books
                const orders = await ordersCollection.find({ bookId: { $in: bookIds } }).toArray();

                res.send(orders);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: 'Failed to fetch orders' });
            }
        });

        // ----------------------
        // Update order status
        // ----------------------
        app.patch('/orders/:id/status', verifyFBToken, async (req, res) => {
            const orderId = req.params.id;
            const email = req.decoded_email;
            const { status } = req.body;

            if (!ObjectId.isValid(orderId))
                return res.status(400).send({ success: false, message: 'Invalid order ID' });

            if (!['pending', 'shipped', 'delivered'].includes(status))
                return res.status(400).send({ success: false, message: 'Invalid status' });

            try {
              
                const order = await ordersCollection.findOne({ _id: new ObjectId(orderId) });
                if (!order) {
                    return res.status(404).send({ message: 'Order not found' });
                }

                const book = await booksCollection.findOne({ _id: new ObjectId(order.bookId), addedBy: email });
                if (!book) {
                    return res.status(403).send({ message: 'Unauthorized' });
                }

               
                const allowedTransitions = {
                    pending: ['shipped'],
                    shipped: ['delivered'],
                    delivered: [],
                };

                if (!allowedTransitions[order.status]?.includes(status)) {
                    return res.status(400).send({ message: 'Invalid status transition' });
                }

                const result = await ordersCollection.updateOne(
                    { _id: new ObjectId(orderId) },
                    { $set: { status, updatedAt: new Date() } }
                );

                res.send({ success: true, result });
            } catch (error) {
                res.status(500).send({ message: 'Server error' });
            }
        });

        // ----------------------
        // Cancel order
        // ----------------------
        app.delete('/orders/:id', verifyFBToken, async (req, res) => {
            const orderId = req.params.id;
            const email = req.decoded_email;

            if (!ObjectId.isValid(orderId))
                return res.status(400).send({ success: false, message: 'Invalid order ID' });

            try {
                // Check if the librarian owns the book for this order
                const order = await ordersCollection.findOne({ _id: new ObjectId(orderId) });
                if (!order) {
                    return res.status(404).send({ message: 'Order not found' });
                }

                const book = await booksCollection.findOne({ _id: new ObjectId(order.bookId), addedBy: email });
                if (!book) {
                    return res.status(403).send({ message: 'Unauthorized' });
                }

                // Prevent canceling delivered orders
                if (order.status === 'delivered') {
                    return res.status(400).send({ message: 'Cannot cancel delivered order' });
                }

                const result = await ordersCollection.deleteOne({ _id: new ObjectId(orderId) });
                res.send({ success: true, result });
            } catch (error) {
                res.status(500).send({ message: 'Server error' });
            }
        });



        // ----------------- Add to Wishlist --------------ঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃঃ
        app.post('/wishlist', async (req, res) => {
            const { userId, bookId } = req.body;
            if (!userId || !bookId) return res.status(400).send({ message: 'Missing userId or bookId' });


            const bookObjectId = new ObjectId(bookId);

            const exists = await wishlistCollection.findOne({ userId, bookId: bookObjectId });
            if (exists) return res.status(400).send({ message: 'Book already in wishlist' });

            const result = await wishlistCollection.insertOne({
                userId,
                bookId: bookObjectId,
                createdAt: new Date()
            });
            res.send(result);
        });


        // User Wishlist 
        app.get('/wishlist/:userId', async (req, res) => {
            const { userId } = req.params;

            const wishlist = await wishlistCollection.aggregate([
                { $match: { userId } },
                {
                    $lookup: {
                        from: 'books',
                        localField: 'bookId',
                        foreignField: '_id',
                        as: 'bookDetails'
                    }
                },
                { $unwind: '$bookDetails' },
                { $replaceRoot: { newRoot: '$bookDetails' } }
            ]).toArray();

            res.send(wishlist);
        });

        // Remove from Wishlist 
        app.delete('/wishlist/:userId/:bookId', async (req, res) => {
            const { userId, bookId } = req.params;
            const result = await wishlistCollection.deleteOne({
                userId,
                bookId: new ObjectId(bookId)
            });

            if (result.deletedCount === 0)
                return res.status(404).send({ message: 'Book not found in wishlist' });

            res.send({ message: 'Book removed from wishlist' });
        });

        // Publish/Unpublish a book
        app.patch('/books/:id/status', verifyFBToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;
            const { status } = req.body;
            if (!['published', 'unpublished'].includes(status))
                return res.status(400).send({ message: 'Invalid status' });

            const result = await booksCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status, updatedAt: new Date() } }
            );

            res.send({ success: true });
        });

        // Delete a book + all its orders
        app.delete('/books/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;

            try {
                await booksCollection.deleteOne({ _id: new ObjectId(id) });
                const ordersDeleted = await ordersCollection.deleteMany({ bookId: id });

                res.send({
                    success: true,
                    message: `Book deleted. ${ordersDeleted.deletedCount} related orders removed.`,
                });
            } catch (err) {
                res.status(500).send({ message: 'Failed to delete book' });
            }
        });








        app.post('/books', async (req, res) => {
            const book = req.body;
            const result = await booksCollection.insertOne(book);
            res.send(result);
        });
        // Courier Post
        app.post('/books', async (req, res) => {
            const book = req.body;
            const result = await booksCollection.insertOne(book);
            res.send(result);
        })
        app.post('/courier', async (req, res) => {
            const courier = req.body;
            courier.createdAt = new Date();
            const result = await courierCollection.insertOne(courier);
            res.send(result);
        });

        app.get('/courier', async (req, res) => {
            const query = {};

            const { email } = req.query;
            if (email) {
                query.senderEmail = email;
            }

            const cursor = courierCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);

        })

        app.get('/courier/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await courierCollection.findOne(query);
            res.send(result);
        })

        // Courier Delete
        app.delete('/courier/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await courierCollection.deleteOne(query);
            res.send(result);
        })


        // Librarian Related Apis

        app.get('/librarian', async (req, res) => {
            const query = {};
            if (req.query.status) {
                query.status = req.query.status;
            }

            const cursor = librarianCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        })

        app.post('/librarian', async (req, res) => {
            const librarian = req.body;
            librarian.status = 'Pending'
            librarian.createdAt = new Date();
            const result = await librarianCollection.insertOne(librarian);
            res.send(result);
        });

        app.patch('/librarian/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const status = req.body.status;
            const id = req.params.id;
            const query = { _id: new ObjectId((id)) }
            const updateDoc = {
                $set: {
                    status: status
                }
            }
            const result = await librarianCollection.updateOne(query, updateDoc);
            if (status === 'Approved') {
                const email = req.body.email;
                const userQuery = { email }
                const updateUser = {
                    $set: {
                        role: 'librarian'
                    }
                }
                const userResult = await userCollection.updateOne(userQuery, updateUser);
            }
            res.send(result);
        })

        app.delete('/librarian/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await librarianCollection.deleteOne(query);
            res.send(result);
        })

        // Payment related APIs
        app.post('/create-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.cost) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data: {
                                name: paymentInfo.bookName,
                            },
                        },
                        quantity: 1,
                    },
                ],
                customer_email: paymentInfo.senderEmail,
                mode: 'payment',
                metadata: {
                    orderId: paymentInfo.orderId,
                    bookName: paymentInfo.bookName
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            });


            res.send({ url: session.url });
        });

        // Payment Success
        app.patch('/payment-success', async (req, res) => {
            try {
                const sessionId = req.query.session_id;

                const session = await stripe.checkout.sessions.retrieve(sessionId);

                const transactionId = session.payment_intent;


                const paymentQuery = { transactionId };
                const paymentExist = await paymentCollection.findOne(paymentQuery);

                if (paymentExist) {
                    return res.send({
                        message: 'already exists',
                        transactionId,
                        trackingId: paymentExist.trackingId
                    });
                }

                if (session.payment_status !== 'paid') {
                    return res.status(400).send({ success: false });
                }

                const trackingId = generateOrderTraceId();
                const orderId = session.metadata.orderId;


                const orderQuery = { _id: new ObjectId(orderId) };

                const update = {
                    $set: {
                        paymentStatus: 'paid',
                        trackingId,
                    },
                };

                const updateResult = await courierCollection.updateOne(orderQuery, update);

                const payment = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    customerEmail: session.customer_email,
                    orderId,
                    bookName: session.metadata.bookName,
                    transactionId,
                    paymentStatus: session.payment_status,
                    paidAt: new Date(),
                    trackingId: trackingId
                };

                await paymentCollection.insertOne(payment);

                res.send({
                    success: true,
                    trackingId,
                    transactionId,
                });
            } catch (err) {
                console.error(err);
                res.status(500).send({
                    success: false,
                    message: 'Payment processing failed',
                });
            }
        });

        // My Payments

        app.get('/payments', verifyFBToken, async (req, res) => {

            const email = req.query.email;
            const query = {};
            if (email) {
                query.customerEmail = email;

                if (email !== req.decoded_email) {
                    return res.status(403).send({ message: 'forbidden access' })
                }
            }

            const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
            const result = await cursor.toArray();
            res.send(result);

        })

        app.get("/dashboard/user", verifyFBToken, async (req, res) => {
            try {
                const email = req.decoded_email;

                const data = await courierCollection.aggregate([
                    { $match: { senderEmail: email } },
                    {
                        $facet: {
                            stats: [
                                {
                                    $group: {
                                        _id: null,
                                        totalOrders: { $sum: 1 },
                                        pendingOrders: {
                                            $sum: { $cond: [{ $eq: ["$paymentStatus", "pending"] }, 1, 0] },
                                        },
                                        totalSpent: {
                                            $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$cost", 0] },
                                        },
                                    },
                                },
                            ],
                            recentOrders: [
                                { $sort: { createdAt: -1 } },
                                { $limit: 5 },
                                {
                                    $project: {
                                        _id: 1,
                                        bookName: 1,
                                        cost: 1,
                                        paymentStatus: 1,
                                        createdAt: 1,
                                    },
                                },
                            ],
                        },
                    },
                ]).toArray();

                const stats = (data[0] && data[0].stats[0]) || {
                    totalOrders: 0,
                    pendingOrders: 0,
                    totalSpent: 0,
                };

                const recentOrders = (data[0] && data[0].recentOrders) || [];

                res.send({ stats, recentOrders });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Failed to fetch user dashboard", error: error.message });
            }
        });



        app.get('/dashboard/librarian', verifyFBToken, async (req, res) => {
            try {
                const email = req.decoded_email;


                const books = await booksCollection.find({ addedBy: email }).toArray();
                const bookIds = books.map(b => b._id.toString());


                const orders = await ordersCollection.find({ bookId: { $in: bookIds } }).toArray();


                const stats = {
                    totalBooks: books.length,
                    totalOrders: orders.length,
                    totalRevenue: orders.reduce((sum, o) => sum + Number(o.price || 0), 0),
                };


                const recentOrders = orders
                    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                    .slice(0, 5)
                    .map(o => ({
                        _id: o._id,
                        bookName: o.bookName,
                        userName: o.buyerEmail,
                        price: Number(o.price),
                        status: o.status,
                        createdAt: o.createdAt,
                    }));


                const recentBooks = books
                    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                    .slice(0, 5)
                    .map(b => ({
                        _id: b._id,
                        title: b.name || b.title,
                        author: b.author,
                        price: Number(b.price || 0),
                        createdAt: b.createdAt,
                    }));

                res.send({ stats, recentOrders, recentBooks });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: 'Failed to fetch dashboard data' });
            }
        });

        app.get('/dashboard/admin', verifyFBToken, verifyAdmin, async (req, res) => {
            const [users, librarians, books] = await Promise.all([
                userCollection.countDocuments(),
                userCollection.countDocuments({ role: "librarian" }),
                booksCollection.countDocuments()
            ]);

            const ordersAgg = await ordersCollection.aggregate([
                {
                    $facet: {
                        revenue: [
                            { $match: { paymentStatus: "paid" } },
                            { $group: { _id: null, totalRevenue: { $sum: "$price" } } }
                        ],
                        ordersByStatus: [
                            {
                                $group: {
                                    _id: "$status",
                                    count: { $sum: 1 }
                                }
                            }
                        ]
                    }
                }
            ]).toArray();

            const recentPayments = await paymentCollection
                .find({})
                .sort({ paidAt: -1 })
                .limit(5)
                .toArray();

            res.send({
                users,
                librarians,
                books,
                totalRevenue: ordersAgg[0].revenue[0]?.totalRevenue || 0,
                ordersByStatus: ordersAgg[0].ordersByStatus,
                recentPayments
            });
        });








        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('BookCourier')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})

