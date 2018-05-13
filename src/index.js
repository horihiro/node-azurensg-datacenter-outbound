import request from 'request';
import querystring from 'querystring';
import xmljson from 'xmljson';

const requestAsync = (url, params) => new Promise((resolve, reject) => {
  request(url, params, (err, header, body) => {
    if (err) {
      reject(err);
      return;
    }
    resolve({ header, body });
  });
});

const xmlToJsonAsync = xml => new Promise((resolve, reject) => {
  xmljson.to_json(xml, (err, json) => {
    if (err) {
      reject(err);
      return;
    }
    resolve(json);
  });
});


export default function (options) {
  if (!options) {
    return Promise.reject(new Error('no option'));
  }
  const {
    subscriptionId,
    resourceGroupName,
    tenantId,
    clientId,
    clientSecret,
    location,
    highPriority,
  } = options;

  // check options
  if (!subscriptionId) {
    return Promise.reject(new Error('no subscriptionId in options'));
  }
  if (!resourceGroupName) {
    return Promise.reject(new Error('no resourceGroupName in options'));
  }
  if (!location) {
    return Promise.reject(new Error('no location in options'));
  }
  if (!tenantId) {
    return Promise.reject(new Error('no tenantId in options'));
  }
  if (!clientId) {
    return Promise.reject(new Error('no clientId in options'));
  }
  if (!clientSecret) {
    return Promise.reject(new Error('no clientSecret in options'));
  }

  // create form data for authentication
  const authForm = querystring.stringify({
    grant_type: 'client_credentials',
    resource: 'https://management.core.windows.net/',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const networkSecurityGroupNamePrefix = options.networkSecurityGroupNamePrefix || 'NSGforAzureDC';
  const securityRuleNamePrefix = options.securityRuleNamePrefix || 'AllowAzureDataCenterOutbound';
  const downloadUrl = options.downloadUrl || 'http://www.microsoft.com/EN-US/DOWNLOAD/confirmation.aspx?id=41653';
  const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/token`;
  const targetRegions = options.targetRegions || [];
  return Promise.all([
    // request for getting ip range list
    requestAsync({ url: downloadUrl })
      .then((response) => {
        const listUrl = response.body.match(/https:\/\/download\.microsoft\.com\/download\/\d+\/\d+\/\d+\/[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\/PublicIPs_\d{8}.xml/)[0];
        if (!listUrl) {
          const err = new Error('download link is not found.');
          Promise.reject(err);
        }
        return listUrl;
      })
      .then(url => requestAsync({ url })) // download ip range list xml
      .then(response => xmlToJsonAsync(response.body)) // convert ip range list from xml to json
      .then((json) => {
        // convert from ipRange to SecurityRule
        if (!json || !json.AzurePublicIpAddresses || !json.AzurePublicIpAddresses.Region) {
          const err = new Error('invalid response');
          Promise.reject(err);
        }
        const regions = json.AzurePublicIpAddresses.Region;
        const securityRulesArray = [];

        Object.keys(regions).forEach((key) => {
          let n = 0;
          const region = regions[key];
          const ipRangeByRegion = {
            region: region.$.Name,
            securityRules: [],
          };
          securityRulesArray.push(ipRangeByRegion);
          const ipRanges = region.IpRange;
          Object.values(ipRanges).forEach((ipRange) => {
            ipRangeByRegion.securityRules.push({
              name: `${securityRuleNamePrefix}-${region.$.Name}-${ipRange.$.Subnet.replace(/\//g, '_')}`,
              properties: {
                protocol: '*',
                sourcePortRange: '*',
                destinationPortRange: '*',
                sourceAddressPrefix: '*',
                destinationAddressPrefix: ipRange.$.Subnet,
                access: 'Allow',
                priority: highPriority ? 100 + n : 4096 - n,
                direction: 'Outbound',
                sourcePortRanges: [],
                destinationPortRanges: [],
                sourceAddressPrefixes: [],
                destinationAddressPrefixes: [],
              },
            });
            n += 1;
          });
        });
        return Array.isArray(targetRegions) && targetRegions.length === 0 ? securityRulesArray : securityRulesArray.filter(securityRules => securityRules.region === targetRegions || targetRegions.indexOf(securityRules.region) >= 0);
      }),
    // request for getting access token
    requestAsync({
      url: authUrl,
      method: 'POST',
      headers: {
        'Content-Length': authForm.length,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: authForm,
    })
      .then(response => JSON.parse(response.body).access_token), // get access_token from response
  ])
    .then((result) => {
      const paramsArray = result[0];
      const authToken = result[1];
      return paramsArray.reduce((prevPromise, params) => {
        const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Network/networkSecurityGroups/${networkSecurityGroupNamePrefix}-${params.region}?api-version=2018-02-01`;
        // get NSG setting
        // https://docs.microsoft.com/en-us/rest/api/virtualnetwork/networksecuritygroups/get
        return prevPromise.then(() => requestAsync({
          url,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
        })
          .then((res) => {
            const body = JSON.parse(res.body);
            const securityRules = (() => {
              if (body.error) {
                return params.securityRules;
              }
              const { maxPriority, minPriority } = params.securityRules.reduce((prevValues, currentSecurityRule) => {
                const { priority } = currentSecurityRule.properties;
                return {
                  maxPriority: prevValues.maxPriority > priority ? prevValues.maxPriority : priority,
                  minPriority: prevValues.minPriority < priority ? prevValues.minPriority : priority,
                };
              }, { maxPriority: 100, minPriority: 4096 });

              const userSecurityRules = body.properties.securityRules.filter((securityRule) => {
                return securityRule.name.indexOf(`${securityRuleNamePrefix}`) !== 0;
              });
              if (!highPriority) userSecurityRules.reverse();

              userSecurityRules.forEach((userSecurityRule, index) => {
                const { priority } = userSecurityRule.properties;
                if (minPriority <= priority && priority <= maxPriority) {
                  userSecurityRule.properties.priority = !highPriority ? (minPriority - index - 1) : (maxPriority + index + 1);
                }
              });
              return params.securityRules.concat(userSecurityRules);
            })();
            // update NSG setting
            // https://docs.microsoft.com/en-us/rest/api/virtualnetwork/networksecuritygroups/createorupdate
            return requestAsync({
              url,
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${authToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                location,
                properties: {
                  securityRules,
                },
              }),
            });
          }));
      }, Promise.resolve({}));
    });
}
