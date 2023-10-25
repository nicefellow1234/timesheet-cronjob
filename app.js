require('dotenv').config();
const express = require('express');
const app = express();
const port = 3000;
const { fetchAccessToken } = require('./common/authenticateRedbooth.js');
const { 
    syncRedboothProjects, 
    syncRedboothProjectsTasks, 
    syncRedboothUsers, 
    syncRedboothTasksLoggings 
} = require('./common/syncRedbooth.js');
const { renderUsersLoggings, generateInvoiceData, generatePdfInvoice } = require('./common/renderMethods.js');
const { User, Logging } = require('./common/db.js')

// Set ejs as express view engine
app.set('views', 'views');
app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({extended: true}));

app.get('/', async (req, res) => {
    const userIdsWithLoggings = await Logging.find().distinct('rbUserId');
    const users = await User.find({ rbUserId: { "$in" : userIdsWithLoggings } }).lean();
    res.render('index', {users});
});

app.get('/authorize', async (req, res) => {
    const accessToken = await fetchAccessToken(null, req.query.code);
    console.log('Access Token in Express Response: ', accessToken);
    res.json(accessToken);
});

app.get('/sync-data', async (req, res) => {
    const { syncDays, projects, tasks, users, loggings } = req.query;
    if (!projects)
        await syncRedboothProjects();
    if (!tasks)
        await syncRedboothProjectsTasks();
    if (!users)
        await syncRedboothUsers();
    if (!loggings)
        await syncRedboothTasksLoggings(syncDays);
    res.send('Synchronization has been completed!')
});

app.get('/render-data', async (req, res) => {
    const { json, month, year, invoice, userId } = req.query;
    var loggingsData = await renderUsersLoggings({month, year, invoice, userId});
    if (json) {
        res.json(loggingsData);
    } else {
        res.render('renderDataView', {loggingsData, month, year});
    }
});

app.get('/generate-invoice', async (req, res) => {
    const { month, year, userId, hourlyRate, invoiceNo, generatePdf, customItem, customValue } = req.query;
    var data = await generateInvoiceData(month, year, userId, hourlyRate, invoiceNo, customItem, customValue);
    if (generatePdf == 1) {
        const invoiceFile = await generatePdfInvoice(data);
        res.download(invoiceFile);
    } else {
        res.render('generateInvoice', {data});
    }
});

app.listen(port, () => {
    console.log(`App listening on port ${port}`)
});

// syncRedboothProjects();
// syncRedboothUsers();
// syncRedboothProjectsTasks;
// syncRedboothTasksLoggings();