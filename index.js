const express = require("express");
const path = require("path");
const app = express();

const { Pool } = require("pg");
require("dotenv").config();

const bcrypt = require('bcryptjs'); //for hashing
const jwt = require('jsonwebtoken'); //tokens for succesful signup/login

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization']; // e.g. "Bearer TOKEN"
  const token = authHeader && authHeader.split(' ')[1]; // extract token part
  if (!token) return res.sendStatus(401); // Unauthorized if no token

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403); // Forbidden if invalid token
    req.user = user; // Add user payload to request object
    next(); // proceed to route handler
  });
}


//This tells Express to parse incoming JSON requests so req.body is defined.
app.use(express.json()) //make sure to put this at top

//code to check if our db is connected or not, shows the current time in the db if connected
app.get("/db-check", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database query failed" });
  }
});


//shows the index html file 
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "/index.html"));
});


//signup route
app.post('/signup', async (req, res) => {
  const { user_email, password } = req.body;

try {
    // Check if user already exists
    const userCheck = await pool.query('SELECT * FROM users WHERE user_email = $1', [user_email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: "Sorry.. This email is already taken!" });
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert the new user into the database (WITH HASHED PW)
    const result = await pool.query(
      "INSERT INTO users (user_email, password) VALUES ($1, $2) RETURNING *",
      [user_email, hashedPassword]
    );

    const user_id = result.rows[0].user_id;

    // Generate a JWT token
    const token = jwt.sign({ user_id, user_email }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(201).json({ user_id, user_email, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Ooops.. Something went wrong" });
}
});

//login route
app.post('/login', async (req, res) => {
  const {user_email, password} = req.body

  try {
    //Select the row with the same email they logged in with
    const user = await pool.query('SELECT * FROM users WHERE user_email = $1', [user_email])
  //if no match, return error
    if (user.rows.length === 0) {
      return res.status(401).json({ error: 'Email not found. Please sign up!' });
    }
    //compare inputted pw with hashed one in db
  const validPass = await bcrypt.compare(password, user.rows[0].password);
    //if not same, send error
  if (!validPass) {
      return res.status(401).json({ error: 'Wrong email or password' });
    }

    //if same, generate a token and send it back to the user
    const user_id = user.rows[0].user_id;
    const token = jwt.sign({ user_id, user_email }, process.env.JWT_SECRET, { expiresIn: '1h' });
 res.json({ user_id, user_email, token });
  
  }
  catch (error) {
    console.error(error);
    res.status(500).json({ error: "Ooops.. Something went wrong" });
  }
})

//friend route
app.post('/friend', authenticateToken, async (req, res) => {
  const user_id = req.user.user_id; // from token
  const { friend_id } = req.body;

  //if not a friend_id, return error. if they try to friend themselves, return error
  if (!friend_id) return res.status(400).json({ error: 'friend_id required' });
  //if they try to friend themselves, return error
  if (friend_id === user_id)
    return res.status(400).json({ error: 'I know you want to friend yourself, but that\'s not how this works!' });

const [user_id_1, user_id_2] =
    user_id < friend_id ? [user_id, friend_id] : [friend_id, user_id];


  try {
    // check if a pending or accepted request already exists
    const existing = await pool.query(
      `SELECT * FROM friendships
       WHERE user_id_1 = $1 AND user_id_2 = $2
         AND status IN ('pending', 'accepted')`,
      [user_id_1, user_id_2]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Friend request already exists' });
    }

    // Insert a new pending friendship request
    await pool.query('INSERT INTO friendships (user_id_1, user_id_2, status) VALUES ($1, $2, $3)', [user_id_1, user_id_2, 'pending']);
    res.status(201).json({ message: 'Friend request sent!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to send friend request' });
  }
});

//for accepting a friend request, we need to check if the request exists and is pending, then update it to accepted
app.patch('/friend/accept', authenticateToken, async (req, res) => {
  const user_id = req.user.user_id;   
  const { friend_id } = req.body;

if (!friend_id) return res.status(400).json({ error: 'friend_id required' });
if (friend_id === user_id)
    return res.status(400).json({ error: 'You cannot accept a friend request from yourself!' });

//compare and prevent duplicate entries by always storing the smaller user_id first
const [user_id_1, user_id_2] =
    user_id < friend_id ? [user_id, friend_id] : [friend_id, user_id];

 try {
    const result = await pool.query(
      `SELECT * FROM friendships
       WHERE user_id_1 = $1 AND user_id_2 = $2 AND status = 'pending'`,
      [user_id_1, user_id_2]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'No pending friend request found' });
    }

    await pool.query(
      `UPDATE friendships
       SET status = 'accepted' WHERE user_id_1 = $1 AND user_id_2 = $2`,
      [user_id_1, user_id_2]
    );

    res.json({ message: 'Friend request accepted!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to accept friend request' });
  }
});


app.get("/posts", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM posts");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});



app.get("/posts/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("SELECT * FROM posts WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.post("/posts", async (req, res) => {
  const { title, content, author } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO posts (title, content, author) VALUES ($1, $2, $3) RETURNING *",
      [title, content, author],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.patch("/posts/:id", async (req, res) => {
  const { id } = req.params;
  const { title, content, author } = req.body;
  try {
    const result = await pool.query(
      "UPDATE posts SET title = $1, content = $2, author = $3 WHERE id = $4 RETURNING *",
      [title, content, author, id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.delete("/posts/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM posts WHERE id = $1 RETURNING *",
      [id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    res.json({ message: "Post deleted", post: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});


app.listen(3000, () => {
  console.log("App is listening on port 3000");
});

