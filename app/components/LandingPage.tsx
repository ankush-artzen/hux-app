"use client";
import { 
    Page, 
    Layout, 
    Card, 
    Button, 
    Banner, 
    Text, 
    BlockStack,
    InlineStack,
    Box,
    InlineGrid,
    Divider
  } from '@shopify/polaris';
  import { TitleBar } from '@shopify/app-bridge-react';
  
  export default function LandingPage() {
    return (
      <Page
        title="Hux Sevdesk Invoice"
        // primaryAction={{
        //   content: 'Get Started',
        //   url: '/setup',
        // }}
      >
        <TitleBar title="Hux Sevdesk Invoice" />
        <Layout>
          <Layout.Section>
            <Banner
              title="Seamless Invoice Integration"
              tone="info"
            >
              <Text as="p" variant="bodyMd">
                Automatically sync Shopify orders with Sevdesk for professional invoicing
              </Text>
            </Banner>
          </Layout.Section>
  
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingXl">
                  Simplify Your Order-to-Invoice Workflow
                </Text>
                <BlockStack gap="200">
                  <InlineStack gap="200" align="start">
                    <Text as="span" variant="bodyMd" fontWeight="semibold" tone="success">✓</Text>
                    <Text as="span" variant="bodyMd">Automatic invoice creation for new orders</Text>
                  </InlineStack>
                  <InlineStack gap="200" align="start">
                    <Text as="span" variant="bodyMd" fontWeight="semibold" tone="success">✓</Text>
                    <Text as="span" variant="bodyMd">Real-time updates when orders change</Text>
                  </InlineStack>
                  <InlineStack gap="200" align="start">
                    <Text as="span" variant="bodyMd" fontWeight="semibold" tone="success">✓</Text>
                    <Text as="span" variant="bodyMd">Direct access to invoices from Shopify Admin</Text>
                  </InlineStack>
                  <InlineStack gap="200" align="start">
                    <Text as="span" variant="bodyMd" fontWeight="semibold" tone="success">✓</Text>
                    <Text as="span" variant="bodyMd">Supports partial/full refunds and cancellations</Text>
                  </InlineStack>
                  <InlineStack gap="200" align="start">
                    <Text as="span" variant="bodyMd" fontWeight="semibold" tone="success">✓</Text>
                    <Text as="span" variant="bodyMd">B2B tax exemption handling</Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
  
          <Layout.Section>
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              <Card>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingLg">
                    How It Works
                  </Text>
                  <BlockStack gap="200">
                    <Text as="dd" variant="bodyMd">
                      <li>Connect your Sevdesk account</li>
                      <li>Configure your invoice templates</li>
                      <li>Set up automation rules</li>
                      <li>Enjoy automatic invoice processing!</li>
                    </Text>
                  </BlockStack>
                  {/* <Box paddingBlockStart="400">
                    <Button variant='primary' url="/setup">
                      Configure Now
                    </Button>
                  </Box> */}
                </BlockStack>
              </Card>
  
              <Card>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingLg">
                    Key Features
                  </Text>
                  <BlockStack gap="400">
                    <BlockStack gap="200">
                      <Text as="h4" variant="bodyMd" fontWeight="semibold">
                        Automated Sync
                      </Text>
                      <Text as="p" variant="bodyMd">
                        Orders automatically create invoices in Sevdesk
                      </Text>
                    </BlockStack>
                    
                    <Divider />
                    
                    <BlockStack gap="200">
                      <Text as="h4" variant="bodyMd" fontWeight="semibold">
                        Admin Integration
                      </Text>
                      <Text as="p" variant="bodyMd">
                        One-click access to invoices from Shopify Admin
                      </Text>
                    </BlockStack>
                    
                    <Divider />
                    
                    <BlockStack gap="200">
                      <Text as="h4" variant="bodyMd" fontWeight="semibold">
                        Tax Handling
                      </Text>
                      <Text as="p" variant="bodyMd">
                        Special support for B2B tax exemptions
                      </Text>
                    </BlockStack>
                  </BlockStack>
                </BlockStack>
              </Card>
            </InlineGrid>
          </Layout.Section>
  
          <Layout.Section>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }