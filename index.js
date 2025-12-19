const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config();
const port = process.env.PORT || 3000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const crypto = require('crypto');

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

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ilappos.mongodb.net/?appName=Cluster0`;



// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();


        const db = client.db("book_courier_db");
        const booksCollection = db.collection('books');
        const coverageCollection = db.collection('coverage');
        const courierCollection = db.collection('courier');
        const paymentCollection = db.collection('payments')

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

                const trackingId = generateOrderTraceId()

                if (session.payment_status !== 'paid') {
                    return res.status(400).send({ success: false });
                }

                const orderId = session.metadata.orderId;

                const query = { _id: new ObjectId(orderId) };

                const update = {
                    $set: {
                        paymentStatus: 'paid',
                        trackingId: trackingId,
                    },
                };

                const updateResult = await courierCollection.updateOne(query, update);

                const payment = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    customerEmail: session.customer_email, 
                    orderId,
                    bookName: session.metadata.bookName,
                    transactionId: session.payment_intent,
                    paymentStatus: session.payment_status,
                    paidAt: new Date(),
                };

                const paymentResult = await paymentCollection.insertOne(payment);

                res.send({
                    success: true,
                    modifyOrder: updateResult,
                    trackingId:trackingId,
                    transactionId: session.payment_intent,
                    paymentInfo: paymentResult,
                });
            } catch (err) {
                console.error(err);
                res.status(500).send({ success: false, message: 'Payment processing failed' });
            }
        });








        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
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
