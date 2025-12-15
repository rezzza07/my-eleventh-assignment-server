const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config();
const port = process.env.PORT || 3000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


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
        })
        










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
