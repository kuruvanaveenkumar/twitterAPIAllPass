const express = require("express");
const app = express();
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const dbPath = path.join(__dirname, "twitterClone.db");
app.use(express.json());
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

let db = null;
const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

//API 1
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const registerQuery = `SELECT * FROM USER WHERE username = '${username}';`;
  const getData = await db.get(registerQuery);

  if (getData === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const addUser = `INSERT INTO 
                          USER(name,username,password, gender)
                           VALUES('${name}', '${username}', '${hashedPassword}', '${gender}');`;
      const addData = await db.run(addUser);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//API2
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const loginUser = `SELECT * FROM USER WHERE username = '${username}';`;
  const userData = await db.get(loginUser);

  if (userData === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const checkPassword = await bcrypt.compare(password, userData.password);
    if (checkPassword === true) {
      const payload = userData;
      const jwtToken = jwt.sign(payload, "MY_SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

const authenticationToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.payload = payload;
        next();
      }
    });
  }
};

//API 3

app.get(
  "/user/tweets/feed/",
  authenticationToken,
  async (request, response) => {
    const { payload } = request;
    const { user_id, name, username, password, gender } = payload;
    const tweetFeed = `SELECT 
                             username,
                             tweet,
                             date_time AS dateTime 
                          FROM
                          (follower
                          INNER JOIN 
                          tweet
                          ON follower.following_user_id = tweet.user_id) AS T
                          INNER JOIN
                          user ON T.user_id = user.user_id
                          WHERE T.follower_user_id = '${user_id}'
                          ORDER BY date_time DESC LIMIT 4;
                         `;
    response.send(await db.all(tweetFeed));
  }
);

app.get("/user/following/", authenticationToken, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, password, gender } = payload;
  const followingUser = `SELECT
                              name 
                            FROM
                            user
                            INNER JOIN
                            follower
                            ON user.user_id = follower.following_user_id
                            WHERE follower.follower_user_id = '${user_id}';`;
  response.send(await db.all(followingUser));
});

//API 5

app.get("/user/followers/", authenticationToken, async (request, response) => {
  const { payload } = request;
  const { user_id } = payload;
  const userFollowers = `SELECT
                             name
                            FROM
                            follower
                            INNER JOIN
                            user
                            ON follower.follower_user_id = user.user_id
                            WHERE follower.following_user_id = '${user_id}';`;
  response.send(await db.all(userFollowers));
});

//API 6
app.get("/tweets/:tweetId/", authenticationToken, async (request, response) => {
  const { payload } = request;
  const { user_id } = payload;
  const { tweetId } = request.params;
  const tweetQuery = `SELECT * FROM tweet WHERE tweet_id = '${tweetId}';`;
  const tweetResult = await db.get(tweetQuery);

  const userFollowersQuery = `SELECT * FROM 
                                follower INNER JOIN user ON
                                follower.following_user_id = user.user_id
                                WHERE follower.follower_user_id = '${user_id}';`;
  const userFollowers = await db.all(userFollowersQuery);
  const result = userFollowers.some(
    (item) => item.following_user_id === tweetResult.user_id
  );
  if (result === true) {
    const tweetsQuery = `SELECT 
                            tweet,
                            COUNT(DISTINCT(T.like_id)) AS likes,
                            COUNT(DISTINCT(reply.reply_id)) AS replies,
                            date_time AS dateTime
                             FROM
                             (tweet INNER JOIN
                             like ON tweet.tweet_id = like.tweet_id
                             )AS T INNER JOIN reply ON T.tweet_id = reply.tweet_id
                            WHERE T.tweet_id = '${tweetId}' AND T.user_id = '${userFollowers[0].user_id}'`;
    const tweetDetails = await db.get(tweetsQuery);
    response.send(tweetDetails);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

//API 7

app.get(
  "/tweets/:tweetId/likes/",
  authenticationToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { payload } = request;
    const { user_id } = payload;
    const likesQuery = `SELECT
                          *
                        FROM 
                        follower INNER JOIN tweet
                        ON follower.following_user_id = tweet.user_id
                         INNER JOIN like ON like.tweet_id = tweet.tweet_id
                        INNER JOIN user ON like.user_id = user.user_id
                        WHERE 
                        tweet.tweet_id = '${tweetId}' AND follower.follower_user_id = '${user_id}';`;

    const likeUsers = await db.all(likesQuery);
    if (likeUsers.length !== 0) {
      let likes = [];
      for (let item of likeUsers) {
        likes.push(item.username);
      }
      response.send({ likes });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//API 8
app.get(
  "/tweets/:tweetId/replies/",
  authenticationToken,
  async (request, response) => {
    const { payload } = request;
    const { user_id } = payload;
    const { tweetId } = request.params;
    const tweetReply = `SELECT
                            *
                           FROM
                           follower INNER JOIN tweet ON
                           follower.following_user_id = tweet.user_id
                           INNER JOIN reply ON reply.tweet_id = tweet.tweet_id
                           INNER JOIN user ON reply.user_id = user.user_id
                        WHERE 
                        tweet.tweet_id = '${tweetId}' AND follower.follower_user_id = '${user_id}';`;
    const replyData = await db.all(tweetReply);

    if (replyData.length !== 0) {
      let replies = [];
      for (let item of replyData) {
        let object = {
          name: item.name,
          reply: item.reply,
        };
        replies.push(object);
      }
      response.send({ replies });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//API 9
app.get("/user/tweets/", authenticationToken, async (request, response) => {
  const { payload } = request;
  const { user_id } = payload;
  const getTweets = `SELECT
                          tweet,
                          COUNT(DISTINCT(like.like_id)) AS likes,
                          COUNT(DISTINCT(reply.reply_id)) AS replies,
                          date_time AS dateTime
                        FROM
                        user INNER JOIN tweet ON user.user_id = tweet.user_id
                        INNER JOIN like ON like.tweet_id = tweet.tweet_id
                        INNER JOIN reply ON reply.tweet_id = tweet.tweet_id
            WHERE user.user_id = '${user_id}'
            GROUP BY
            tweet.tweet_id;`;
  response.send(await db.all(getTweets));
});

//API 10

app.post("/user/tweets/", authenticationToken, async (request, response) => {
  const { payload } = request;
  const { user_id } = payload;
  const { tweet } = request.body;

  const addTweet = `INSERT INTO tweet(tweet, user_id)
                       VALUES('${tweet}', '${user_id}');`;
  await db.run(addTweet);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticationToken,
  async (request, response) => {
    const { payload } = request;
    const { user_id } = payload;
    const { tweetId } = request.params;
    const query = `SELECT * FROM tweet WHERE  tweet_id = '${tweetId}' AND user_id = '${user_id}';`;
    const dQuery = await db.all(query);
    if (dQuery.length !== 0) {
      const deleteQuery = `DELETE FROM tweet WHERE tweet_id = '${tweetId}' AND user_id = '${user_id}';`;
      await db.run(deleteQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
