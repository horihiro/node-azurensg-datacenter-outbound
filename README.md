# azurensg-datacenter-outbound
This module is to create or update Azure Network Security Group to set IP address of Azure Data Center for outboud security rules.

And uses below Azure REST APIs
 - To get NSG setting : https://docs.microsoft.com/en-us/rest/api/virtualnetwork/networksecuritygroups/get
 - To create or update NSG setting : https://docs.microsoft.com/en-us/rest/api/virtualnetwork/networksecuritygroups/createorupdate

## Usage

Before using this module, the service principal must be created.
Refert to [this doc](https://docs.microsoft.com/en-us/cli/azure/create-an-azure-service-principal-azure-cli?view=azure-cli-latest#create-the-service-principal).

```
import NsgUpdate from 'azurensg-datacenter-outbound';

NsgUpdate({
  subscriptionId: '<subscriptionId>',                     // required
  resourceGroupName: '<resourceGroupName>',               // required
  location: '<regionOfNsg>',                              // required
  tenantId: '<tenantOfServicePrincipal>',                 // required
  clientId: '<appIdOfServicePrincipal>',                  // required
  clientSecret: '<passwordOfServicePrincipal>',           // required

  networkSecurityGroupNamePrefix: '<prefixForNsgName>',   // optional, default is 'NSGforAzureDC'
  securityRuleNamePrefix: '<prefixForSecurityRuleName>',  // optional, default is 'AllowAzureDataCenterOutbound'
  targetRegions: [                                        // optional, default is all regions
    'japaneast',
    'japanwest',
    // :
  ],
  highPriority: true,                                     // optional, default is false
                                                          // `true` means the priorities of security rules starts from 100 to downwand,
                                                          // `false` means the priorities of these start with start from 4096 to upward
})
  .then((res) => {
    console.log(res);
  })
  .catch((err) => {
    console.error(err);
  });
```

After executing above code, created or updated the Network Security Groups as below structure.

```
Subscription: <subscriptionId>
└─── RG: <resourceGroupName>
          ├── NSG: <prefixForNsgName>-{targetRegions[0]}
          │      ├── SR(priority:100) <prefixForSecurityRuleName>-{targetRegions[0]}-{IP_range_desitination_1}
          │      ├── SR(priority:101) <prefixForSecurityRuleName>-{targetRegions[0]}-{IP_range_desitination_2}
          │       :
          │      └── SR(priority:100+N-1): <prefixForSecurityRuleName>-{targetRegions[0]}-{IP_range_desitination_N}
          │
          ├── NSG: <prefixForNsgName>-{targetRegions[1]}
          │      ├── SR(priority:100): <prefixForSecurityRuleName>-{targetRegions[1]}-{IP_range_desitination_1}
          │      ├── SR(priority:101): <prefixForSecurityRuleName>-{targetRegions[1]}-{IP_range_desitination_2}
          │       :
          │      └── SR(priority:100+M-1): <prefixForSecurityRuleName>-{targetRegions[1]}-{IP_range_desitination_M}
           :

```
