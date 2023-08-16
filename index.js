require('dotenv').config(); 
const express = require('express');
const querystring = require('querystring'); 
const axios = require('axios');
const session = require('express-session');
const { access } = require('fs');
const NodeCache = require('node-cache');
const hubspot = require('@hubspot/api-client');

const app = express();

const accessTokenCache = new NodeCache(); 

app.set('view engine', 'pug');

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const REDIRECT_URI = `http://localhost:3000/oauth-callback`

const authUrl = `https://app.hubspot.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=content%20automation%20timeline%20oauth%20transactional-email%20tickets%20e-commerce%20communication_preferences.read_write%20crm.objects.contacts.read%20communication_preferences.read%20communication_preferences.write%20settings.users.write%20crm.objects.contacts.write%20crm.objects.companies.write%20settings.users.read%20crm.schemas.contacts.read%20crm.objects.companies.read%20crm.objects.deals.read%20crm.objects.deals.write%20crm.schemas.contacts.write%20crm.schemas.deals.read%20crm.schemas.deals.write%20conversations.read%20conversations.write%20crm.schemas.quotes.read%20crm.schemas.line_items.read`;

const refreshTokenStore = {};

app.use(session({
    secret: Math.random().toString(36).substring(2),
    resave: false,
    saveUninitialized: true
}));

const isAuthorized = (userId) => {
    return refreshTokenStore[userId] ? true : false;
}

const getToken = async (userId) => {
    if (accessTokenCache.get(userId)) { 
        console.log(accessTokenCache.get(userId)); 
        return accessTokenCache.get(userId);
    }else{
        try {
            const refreshTokenProof = {
                grant_type: 'refresh_token',
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                refresh_token: refreshTokenStore [userId]
            };
            const responseBody = await axios.post('https://api.hubspot.com/oauth/v1/token', querystring.stringify(refreshTokenProof)); 
            refreshTokenStore [userId] = responseBody.data.refresh_token;
            accessTokenCache.set(userId, responseBody.data.access_token, 3);
            console.log('getting refresh token'); 
            return responseBody.data.access_token;
        } catch (e) {
            console.error(e);
        }
    }
}

// 1. Send user to authorization page. This kicks off initial request to OAuth server
app.get('/', async (req, res) => {
    if (isAuthorized(req.sessionID)) {
        const accessToken = await getToken(req.sessionID);
        createProperties(accessToken);
        const headers = {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        };
        const params = {
            //limit: 1,
            count: 1,
        };
        const contacts = 'https://api.hubapi.com/contactslistseg/v1/lists/all/contacts/recent';
        async function fetchContactData() {
            try {
                const resp = await axios.get(contacts, {headers, params});
                const data = resp.data.contacts[0];
                const Cid = data.vid;
                console.log('ContactId:', Cid);
                updateContact(Cid, accessToken);
                const hubspotClient = new hubspot.Client({ "accessToken": accessToken});
                const getResponse = await hubspotClient.crm.contacts.basicApi.getById(Cid);
                res.render('home', {
                    token: accessToken,
                    contactId: data,
                    contactData: getResponse
                });
            } catch (error) { 
                console.error(error);
            }
        }
        setInterval(fetchContactData, 2000); // Fetch data every 2 seconds
    }else{
        res.render("home", { authUrl });
    }
});

// 2. Get temporary authorization code from OAuth server // 3. Combine temporary auth code with app credentials and send back to OAuth server // 4. Get access and refresh tokens

app.get('/oauth-callback', async (req, res) => {
    // res.send(req.query.code);

    const authCodeProof = {
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code: req.query.code
    };
    try{
        const responseBody = await axios.post('https://api.hubspot.com/oauth/v1/token', querystring.stringify(authCodeProof));
        // res.json(responseBody.data);
        // 4. Get access and refresh token
        refreshTokenStore[req.sessionID] = responseBody.data.access_token;
        accessTokenCache.set(req.sessionID, responseBody.data.access_token, 3);
        res.redirect('/');
    }catch (error) {
        console.error(error);
    }
});

app.listen(3000, () => console.log('App running here: http://localhost:3000'));


// function for updating fields 
async function updateContact(contactId, accessToken) {
    try {      
        const hubspotClient = new hubspot.Client({ "accessToken": accessToken});
        // Populate UTM parameters into custom properties
        var pageUrl = 'https://www.example.com/?utm_campaign=test_campaign&utm_medium=test_medium&utm_source=test_source&utm_content=test_content&utm_term=test_term&campaign_id=123&user_id=456';
        var urlParams = new URLSearchParams(pageUrl.split('?')[1]);
    
        // Update the contact with the merged properties
        const updateData = {
            properties: {
            utm_campaign1: urlParams.get('utm_campaign') || '',
            utm_source1: urlParams.get('utm_source') || '',
            utm_medium1: urlParams.get('utm_medium') || '',
            utm_term1: urlParams.get('utm_term') || '',
            utm_content1: urlParams.get('utm_content') || '',
            user_id: urlParams.get('user_id') || '',
            utm_campaign_first_touch: urlParams.get('utm_campaign') || '',
            utm_source_first_touch: urlParams.get('utm_source') || '',
            utm_medium_first_touch: urlParams.get('utm_medium') || '',
            utm_term_first_touch: urlParams.get('utm_term') || '',
            utm_content_first_touch: urlParams.get('utm_content') || '',
            utm_campaign_last_touch: urlParams.get('utm_campaign') || '',
            utm_source_last_touch: urlParams.get('utm_source') || '',
            utm_medium_last_touch: urlParams.get('utm_medium') || '',
            utm_term_last_touch: urlParams.get('utm_term') || '',
            utm_content_last_touch: urlParams.get('utm_content') || '',
            // Add more properties as needed based on your HubSpot configuration
            }
        };
    
        const updateResponse = await hubspotClient.crm.contacts.basicApi.update(contactId, updateData);
        console.log('Data added successfully against this ID:', updateResponse);
        console.log(JSON.stringify(updateResponse.id, null, 2));
    } catch (e) {
        e.message === 'HTTP request failed'
        ? console.error(JSON.stringify(e.response, null, 2))
        : console.error(e);
    }
}

// code for createing custom fields in HubSpot for UTM Tracking App  
const propertiesToCreate =[
    {
      name: "utm_campaign1",
      label: "UTM_Campaign1",
      type: "string",
      fieldType: "text",
      groupName: "contactinformation",
      displayOrder: 3,
      hasUniqueValue: false,
      hidden: false,
      formField: true
    },
    {
        name: "utm_source1",
        label: "UTM_Source1",
        type: "string",
        fieldType: "text",
        groupName: "contactinformation",
        displayOrder: 4,
        hasUniqueValue: false,
        hidden: false,
        formField: true
    },
    {
        name: "utm_medium1",
        label: "UTM_Medium1",
        type: "string",
        fieldType: "text",
        groupName: "contactinformation",
        displayOrder: 5,
        hasUniqueValue: false,
        hidden: false,
        formField: true
    },
    {
          name: "utm_term1",
          label: "UTM_Term1",
          type: "string",
          fieldType: "text",
          groupName: "contactinformation",
          displayOrder: 6,
          hasUniqueValue: false,
          hidden: false,
          formField: true
    },
    {
          name: "utm_content1",
          label: "UTM_Content1",
          type: "string",
          fieldType: "text",
          groupName: "contactinformation",
          displayOrder: 7,
          hasUniqueValue: false,
          hidden: false,
          formField: true
    },
    {
          name: "user_id",
          label: "User_id",
          type: "string",
          fieldType: "text",
          groupName: "contactinformation",
          displayOrder: 8,
          hasUniqueValue: false,
          hidden: false,
          formField: true
    },
    {
          name: "utm_campaign_first_touch",
          label: "UTM_Campaign(First Touch)",
          type: "string",
          fieldType: "text",
          groupName: "contactinformation",
          displayOrder: 9,
          hasUniqueValue: false,
          hidden: false,
          formField: true
    },
    {
          name: "utm_source_first_touch",
          label: "UTM_Source(First Touch)",
          type: "string",
          fieldType: "text",
          groupName: "contactinformation",
          displayOrder: 10,
          hasUniqueValue: false,
          hidden: false,
          formField: true
    },
    {
          name: "utm_medium_first_touch",
          label: "UTM_Medium(First Touch)",
          type: "string",
          fieldType: "text",
          groupName: "contactinformation",
          displayOrder: 11,
          hasUniqueValue: false,
          hidden: false,
          formField: true
    },
    {
          name: "utm_term_first_touch",
          label: "UTM_Term(First Touch)",
          type: "string",
          fieldType: "text",
          groupName: "contactinformation",
          displayOrder: 12,
          hasUniqueValue: false,
          hidden: false,
          formField: true
    },
    {
          name: "utm_content_first_touch",
          label: "UTM_Content(First Touch)",
          type: "string",
          fieldType: "text",
          groupName: "contactinformation",
          displayOrder: 13,
          hasUniqueValue: false,
          hidden: false,
          formField: true
    },
    {
          name: "utm_campaign_last_touch",
          label: "UTM_Campaign(Last Touch)",
          type: "string",
          fieldType: "text",
          groupName: "contactinformation",
          displayOrder: 14,
          hasUniqueValue: false,
          hidden: false,
          formField: true
    },
    {
          name: "utm_source_last_touch",
          label: "UTM_Source(Last Touch)",
          type: "string",
          fieldType: "text",
          groupName: "contactinformation",
          displayOrder: 15,
          hasUniqueValue: false,
          hidden: false,
          formField: true
      },
      {
          name: "utm_medium_last_touch",
          label: "UTM_Medium(Last Touch)",
          type: "string",
          fieldType: "text",
          groupName: "contactinformation",
          displayOrder: 16,            
          hasUniqueValue: false,
          hidden: false,
          formField: true
      },
      {
          name: "utm_term_last_touch",
          label: "UTM_Term(Last Touch)",
          type: "string",
          fieldType: "text",
          groupName: "contactinformation",
          displayOrder: 17,
          hasUniqueValue: false,
          hidden: false,
          formField: true
      },
      {
          name: "utm_content_last_touch",
          label: "UTM_Content(Last Touch)",
          type: "string",
          fieldType: "text",
          groupName: "contactinformation",
          displayOrder: 18,
          hasUniqueValue: false,
          hidden: false,
          formField: true
      }
    // Add other properties following the same pattern
];
const objectType = "contacts";

// function to create fields in contact obj of HS 
async function createProperties(accessToken) {
    const hubspotClient = new hubspot.Client({"accessToken": accessToken});
    try {
      for (const property of propertiesToCreate) {
        const apiResponse = await hubspotClient.crm.properties.coreApi.create(objectType, property);
        console.log(JSON.stringify(apiResponse, null, 2));
      }
    } catch (e) {
      e.message === 'HTTP request failed'
        ? console.error(JSON.stringify(e.response, null, 2))
        : console.error(e);
    }
}
