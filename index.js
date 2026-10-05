const express = require("express");
const path = require("path");
const app = express();

const { Pool } = require("pg");
require("dotenv").config();

const cors = require("cors");
app.use(cors());
app.use(express.json());

const bcrypt = require('bcryptjs'); //for hashing
const jwt = require('jsonwebtoken'); //tokens for succesful signup/login

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization']; // e.g. "Bearer TOKEN"
  const token = authHeader && authHeader.split(' ')[1]; // extract token part
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' }); // Forbidden if invalid token
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


//---LOGIN/SIGNUP---//

//signup route
app.post('/signup', async (req, res) => {
  const { user_email, password } = req.body;

if (!user_email || !password) {
  return res.status(400).json({ error: 'email and password required' });
}

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
    const token = jwt.sign({ user_id, role: result.rows[0].role, user_email }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(201).json({ user_id, user_email, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Ooops.. Something went wrong" });
}
});

//login route
app.post('/login', async (req, res) => {
  const {user_email, password} = req.body

  if (!user_email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

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
    const role = user.rows[0].role;
    const token = jwt.sign({ user_id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
 res.json({ user_id, role, token });
  
  }
  catch (error) {
    console.error(error);
    res.status(500).json({ error: "Ooops.. Something went wrong" });
  }
})


//---FRIENDSHIP---//

//friend route
app.post('/friend', authenticateToken, async (req, res) => {
  const user_id = req.user.user_id; // from token
const friend_id = parseInt(req.body.friend_id, 10);
  //if not a friend_id, return error. if they try to friend themselves, return error
  if (!friend_id) return res.status(400).json({ error: 'friend_id required' });
  //if they try to friend themselves, return error
  if (friend_id === user_id)
    return res.status(400).json({ error: 'I know you want to friend yourself, but that\'s not how this works!' });

const [user_id_1, user_id_2] =
    user_id < friend_id ? [user_id, friend_id] : [friend_id, user_id];
    //5 -> 2
    //2 -> 5 
    //compare and prevent duplicate entries by always storing the smaller user_id first


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
    await pool.query('INSERT INTO friendships (user_id_1, user_id_2, status, requested_by) VALUES ($1, $2, $3, $4)', [user_id_1, user_id_2, 'pending', user_id]);
    res.status(201).json({ message: 'Friend request sent!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to send friend request' });
  }
});

// list your accepted friends (plural dont forget)
app.get('/friends', authenticateToken, async (req, res) => {
  const userId = req.user.user_id;

  try {
    const result = await pool.query(
      `SELECT u.user_id, p.username, p.age, p.bio, p.city
       FROM friendships f
       JOIN users u
         ON u.user_id = CASE WHEN f.user_id_1 = $1 THEN f.user_id_2 ELSE f.user_id_1 END
       LEFT JOIN profiles p ON p.user_id = u.user_id
       WHERE f.status = 'accepted'
         AND (f.user_id_1 = $1 OR f.user_id_2 = $1)`,
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to get friends' });
  }
});

// list pending requests that other people sent to you
app.get('/friend/requests', authenticateToken, async (req, res) => {
  const userId = req.user.user_id;

  try {
    const result = await pool.query(
      `SELECT u.user_id, p.username, p.city
       FROM friendships f
       JOIN users u ON u.user_id = f.requested_by
       LEFT JOIN profiles p ON p.user_id = u.user_id
       WHERE f.status = 'pending'
         AND f.requested_by != $1
         AND (f.user_id_1 = $1 OR f.user_id_2 = $1)`,
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to get friend requests' });
  }
});

// unfriend, reject a request, or cancel a request you sent
app.delete('/friend/:friend_id', authenticateToken, async (req, res) => {
  const user_id = req.user.user_id;
  const friend_id = parseInt(req.params.friend_id, 10);

  if (!friend_id) return res.status(400).json({ error: 'friend_id required' });
  if (friend_id === user_id) return res.status(400).json({ error: 'Invalid friend_id' });

  const [user_id_1, user_id_2] =
    user_id < friend_id ? [user_id, friend_id] : [friend_id, user_id];

  try {
    const result = await pool.query(
      `DELETE FROM friendships
       WHERE user_id_1 = $1 AND user_id_2 = $2
         AND status IN ('pending', 'accepted')
       RETURNING *`,
      [user_id_1, user_id_2]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No friendship or request found' });
    }

    res.json({ message: 'Removed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

//for accepting a friend request, we need to check if the request exists and is pending, then update it to accepted
app.patch('/friend/accept', authenticateToken, async (req, res) => {
  const user_id = req.user.user_id;   
const friend_id = parseInt(req.body.friend_id, 10);

if (!friend_id) return res.status(400).json({ error: 'friend_id required' });
if (friend_id === user_id)
    return res.status(400).json({ error: 'You cannot accept a friend request from yourself!' });

//compare and prevent duplicate entries by always storing the smaller user_id first
const [user_id_1, user_id_2] =
    user_id < friend_id ? [user_id, friend_id] : [friend_id, user_id];

 try {
    const result = await pool.query(
      `SELECT * FROM friendships
       WHERE user_id_1 = $1 AND user_id_2 = $2 AND status = 'pending' AND requested_by != $3`,
      [user_id_1, user_id_2, user_id]
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

//---POSTS---//

//to retrive all posts, we need to check the user's role and apply visibility and friendship filters accordingly
app.get('/posts', authenticateToken, async (req, res) => {
  const userId = req.user.user_id;
  const role = req.user.role;

  try {
    let result;
    if (role === 'admin') {
      // Admins can see all posts, so no filters are applied
  result = await pool.query(
    `SELECT p.*, pr.username
     FROM posts p
     LEFT JOIN profiles pr ON pr.user_id = p.user_id
     ORDER BY p.created_at DESC`
  );
} else {
  // For regular users, apply visibility and friendship filters
  result = await pool.query(
    `SELECT p.*, pr.username
     FROM posts p
     LEFT JOIN profiles pr ON pr.user_id = p.user_id
     WHERE p.visibility = 'Public'
        OR p.user_id = $1
        OR (p.visibility = 'Friends-Only' AND EXISTS (
             SELECT 1 FROM friendships f
             WHERE f.status = 'accepted' AND (
               (f.user_id_1 = $1 AND f.user_id_2 = p.user_id) OR
               (f.user_id_2 = $1 AND f.user_id_1 = p.user_id)
             )
           ))
     ORDER BY p.created_at DESC`,
    [userId]
  );
}
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

//get a specific post by id, with visibility and friendship checks
app.get("/posts/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.user_id;
  const role = req.user.role;
  
  try {
    const postResult = await pool.query('SELECT * FROM posts WHERE post_id = $1', [id]);
    if (postResult.rows.length === 0)
      return res.status(404).json({ error: 'Post not found' });
    
    const post = postResult.rows[0];

    if (role === 'admin' || post.visibility === 'Public' || post.user_id === userId) {
      return res.json(post);
    }

    if (post.visibility === 'Friends-Only') {
      const friendCheck = await pool.query(
        `SELECT 1 FROM friendships f
         WHERE f.status = 'accepted' AND (
           (f.user_id_1 = $1 AND f.user_id_2 = $2) OR
           (f.user_id_2 = $1 AND f.user_id_1 = $2)
         )`,
         [userId, post.user_id]
      );
      if (friendCheck.rows.length > 0) {
        return res.json(post);
      } else {
        return res.status(403).json({ error: 'Forbidden: not friends with this user' });
      }
    }

    res.status(403).json({ error: 'Forbidden: insufficient permissions' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

//posting a new post.
app.post("/posts", authenticateToken, async (req, res) => {
  const { title, content, visibility, image_url } = req.body;
   const role = req.user.role;
  const owner = role === 'admin' && req.body.user_id ? req.body.user_id : req.user.user_id;


   if (!visibility) return res.status(400).json({ error: 'visibility required' });

  try {
    const result = await pool.query(
      "INSERT INTO posts (title, content, user_id, visibility, image_url) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [title, content, owner, visibility, image_url],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

//updating an existing post
app.patch("/posts/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { title, content, visibility, image_url } = req.body;
  const userId = req.user.user_id;
  const role = req.user.role;

  try {
     // Get the post to check ownership
    const postResult = await pool.query('SELECT * FROM posts WHERE post_id = $1', [id]);
    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = postResult.rows[0];

    // Check if the user is the owner of the post or an admin
    if (role !== 'admin' && post.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: you can only update your own posts' });
    }
// Update the post
    const result = await pool.query(
        `UPDATE posts
   SET title = COALESCE($1, title),
       content = COALESCE($2, content),
       visibility = COALESCE($3, visibility),
       image_url = COALESCE($4, image_url)
   WHERE post_id = $5 RETURNING *`,
      [title, content, visibility, image_url, id],
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

// deleting an existing post
app.delete('/posts/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.user_id;
  const role = req.user.role;

  try {
    // Check if post exists
    const postResult = await pool.query('SELECT * FROM posts WHERE post_id = $1', [id]);
    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = postResult.rows[0];

    // Check ownership or admin
    if (role !== 'admin' && post.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: you can only delete your own posts' });
    }

    // Delete post
    await pool.query('DELETE FROM posts WHERE post_id = $1', [id]);

    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});


//---PROFILES---//

// get a profile
app.get('/profiles/:user_id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM profiles WHERE user_id = $1', [req.params.user_id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Profile not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// create your own profile
app.post('/profiles', authenticateToken, async (req, res) => {
  const { username, age, bio, city } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });

  try {
    const result = await pool.query(
      'INSERT INTO profiles (user_id, username, age, bio, city) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.user_id, username, age, bio, city]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Profile already exists or username is taken' });
  }
});

// update your own profile
app.patch('/profiles', authenticateToken, async (req, res) => {
  const { username, age, bio, city } = req.body;
  try {
    const result = await pool.query(
      `UPDATE profiles
       SET username = COALESCE($1, username),
           age = COALESCE($2, age),
           bio = COALESCE($3, bio),
           city = COALESCE($4, city)
       WHERE user_id = $5 RETURNING *`,
      [username, age, bio, city, req.user.user_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Profile not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`App is listening on port ${PORT}`);
});