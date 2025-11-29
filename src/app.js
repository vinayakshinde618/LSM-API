const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const responseWrapper = require('response-json-wrapper');
const cors = require('cors');
const path = require('path');

// console.log = function() {}; 

// app.use(logMiddleware);
app.use(cors());

// body-parser
app.use(bodyParser.json({ limit: "150mb" }));
app.use(bodyParser.urlencoded({ limit: "150mb", extended: true, parameterLimit: 50000, }));
app.use(bodyParser.json());
app.use(responseWrapper);

app.use("/api", require("./app/router/index"));
// view routes
// Set the view engine to EJS
app.set('view engine', 'ejs');

// Serve static files from the "public" folder
app.use(express.static('public'));
app.use("/", require("./views/views.route"));
app.use("/uploads", express.static(path.join(__dirname, '..', 'uploads')));

app.use((req, res, next) => {
    res.status(400).send(`
          <h1> Page not found!</h1>
          <h4> Please Check URL - <b style="color:red">'${req.url}'</b></h4>
          <script>
              setTimeout(() => {
                  const loginUser = localStorage.getItem("loginUser");
                  if (loginUser) {
                      window.location.href = "/payload_form";
                  } else {
                      window.location.href = "/login";
                  }
              }, 3000);
          </script>
      `);
});

module.exports = app;