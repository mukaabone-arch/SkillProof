const express = require('express');
const app = express();

const hits = [];
function reg(method, path, label) {
  app[method](path, (req, res) => { hits.push(label); res.json({ label }); });
}

// JobsController (employer) routes, in declared order:
reg('post', '/jobs', 'employer:create');
reg('get',  '/jobs', 'employer:list');
reg('patch','/jobs/:id', 'employer:update');
reg('post', '/jobs/:id/skills', 'employer:setSkills');
reg('post', '/jobs/parse-description', 'employer:parseDescription');
reg('get',  '/jobs/:id/matches', 'employer:matches');

// CandidateJobsController routes, in declared order:
reg('get',  '/jobs/browse', 'candidate:browse');
reg('get',  '/jobs/matched', 'candidate:matched');
reg('get',  '/jobs/browse/:id', 'candidate:browseOne');
reg('post', '/jobs/:id/apply', 'candidate:apply');

const server = app.listen(0, async () => {
  const port = server.address().port;
  const http = require('http');
  function call(method, path) {
    return new Promise((resolve) => {
      const req = http.request({ port, method, path }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.end();
    });
  }
  console.log('GET /jobs/browse       ->', JSON.stringify(await call('GET', '/jobs/browse')));
  console.log('GET /jobs/matched      ->', JSON.stringify(await call('GET', '/jobs/matched')));
  console.log('GET /jobs/browse/abc   ->', JSON.stringify(await call('GET', '/jobs/browse/abc')));
  console.log('POST /jobs/abc/apply   ->', JSON.stringify(await call('POST', '/jobs/abc/apply')));
  server.close();
});
