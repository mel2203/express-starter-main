# Peanut Butter & Jelly: Backend API

REST API built with Express and PostgreSQL (Supabase).

**Base URL:** [`https://peanutbutterandjelly-backend-production.up.railway.app']

## Database

| Table       | Columns                                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| users       | `user_id`, `user_email`, `password` (bcrypt hash), `role`                         |
| profiles    | `user_id`, `username`, `age`, `bio`, `city`                                       |
| posts       | `post_id`, `user_id`, `visibility`, `title`, `content`, `image_url`, `created_at` |
| friendships | `id`, `user_id_1`, `user_id_2`, `status`, `requested_by`                          |

Friendships always store the **smaller** user id in `user_id_1`, so each pair of users has one row.

## Authentication

Protected routes need a token from `/signup` or `/login`:

```
Authorization: Bearer <token>
```

Tokens last 1 hour. A missing token returns `401`, and an invalid or expired one returns `403`.

## Endpoints

| Method | Endpoint             | Auth | Body                                                     | Description                              |
| ------ | -------------------- | ---- | -------------------------------------------------------- | ---------------------------------------- |
| GET    | `/db-check`          | No   |                                                          | Check the database connection            |
| POST   | `/signup`            | No   | `user_email`, `password`                                 | Create an account, returns a token       |
| POST   | `/login`             | No   | `user_email`, `password`                                 | Log in, returns `user_id`, `role`, token |
| GET    | `/profiles/:user_id` | Yes  |                                                          | Get a profile                            |
| POST   | `/profiles`          | Yes  | `username` (required), `age`, `bio`, `city`              | Create your profile                      |
| PATCH  | `/profiles`          | Yes  | any of `username`, `age`, `bio`, `city`                  | Update your profile                      |
| POST   | `/friend`            | Yes  | `friend_id`                                              | Send a friend request                    |
| PATCH  | `/friend/accept`     | Yes  | `friend_id`                                              | Accept a request sent to you             |
| DELETE | `/friend/:friend_id` | Yes  |                                                          | Unfriend, reject or cancel a request     |
| GET    | `/friends`           | Yes  |                                                          | List your accepted friends               |
| GET    | `/friend/requests`   | Yes  |                                                          | List requests sent to you                |
| GET    | `/posts`             | Yes  |                                                          | Get posts you are allowed to see         |
| GET    | `/posts/:id`         | Yes  |                                                          | Get one post                             |
| POST   | `/posts`             | Yes  | `visibility` (required), `title`, `content`, `image_url` | Create a post                            |
| PATCH  | `/posts/:id`         | Yes  | any of `title`, `content`, `visibility`, `image_url`     | Update your post                         |
| DELETE | `/posts/:id`         | Yes  |                                                          | Delete your post                         |

### Example

```http
POST /login
Content-Type: application/json

{ "user_email": "amira@example.com", "password": "mypassword" }
```

```json
{ "user_id": 1, "role": "user", "token": "eyJhbGciOi..." }
```

## Rules

**Post visibility**

| Value          | Who can see it                        |
| -------------- | ------------------------------------- |
| `Public`       | Everyone                              |
| `Friends-Only` | The author and their accepted friends |
| `Private`      | Only the author                       |

**Roles**

- `user` (default): manages their own posts, profile and friends.
- `admin`: can view, edit and delete any post, and create posts for other users by sending `user_id`.

To make an admin, set `role = 'admin'` in the Supabase `users` table, then log in again, because the role is stored in the token.

**Common errors**

| Status | Meaning                                                   |
| ------ | --------------------------------------------------------- |
| 400    | Missing or invalid input, or a duplicate request or email |
| 401    | No token, or wrong email or password                      |
| 403    | Invalid token, or you don't have permission               |
| 404    | Post, profile or friendship not found                     |
| 500    | Server error                                              |
