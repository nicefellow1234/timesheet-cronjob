require('dotenv').config();
const express = require('express');
const ejs = require('ejs');
const fs = require('fs');
const app = express();
const port = 3000;
const puppeteer = require('puppeteer');
const { fetchAccessToken } = require('./common/authenticateRedbooth.js');
const { 
    syncRedboothProjects, 
    syncRedboothProjectsTasks, 
    syncRedboothUsers, 
    syncRedboothTasksLoggings 
} = require('./common/syncRedbooth.js');
const { renderUsersLoggings, generateInvoiceData } = require('./common/renderMethods.js');

// Set ejs as express view engine
app.set('views', 'views');
app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({extended: true}));

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
    const { month, year, invoice, userId } = req.query;
    var loggingsData = await renderUsersLoggings({month, year, invoice, userId});
    res.json(loggingsData);
});

app.get('/render-data-view', async (req, res) => {
    const { month, year, invoice, userId } = req.query;
    var loggingsData = await renderUsersLoggings({month, year, invoice, userId});
    res.render('renderDataView', {loggingsData, month, year});
});

app.get('/generate-pdf-invoice', async (req, res) => {
    const { month, year, userId, hourlyRate, generatePdf } = req.query;
    var data = await generateInvoiceData(month, year, userId, hourlyRate);
    if (generatePdf) {
        const browser = await puppeteer.launch({headless: "new"});
        const page = await browser.newPage();
        const html = fs.readFileSync('./views/invoiceTemplate.ejs', 'utf-8');
        const renderedHtml = ejs.render(html, {data});
        await page.setContent(renderedHtml, { waitUntil: 'domcontentloaded'});
        // To reflect CSS used for screens instead of print
        await page.emulateMediaType('screen');
        //await page.screenshot({path: "canvas.png"})
        await page.pdf({
            path: `./invoices/${data.name} - ${data.invoiceDate}.pdf`
        });
        await browser.close();
        res.send('PDF invoice has been generated!');
    } else {
        res.render('invoiceTemplate', {data});
    }
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
});

// syncRedboothProjects();
// syncRedboothUsers();
// syncRedboothProjectsTasks;
// syncRedboothTasksLoggings();