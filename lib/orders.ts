export async function getOrder(orderId:string,shop: string,accessToken: string) {
    const url = `https://${shop}/admin/api/2023-07/orders/${orderId}.json?fields=id,line_items,created_at,tags,note,note_attributes,name,total_price,shipping_address,billing_address,customer,discounts,discount_application`;
  
    let order = null;
    await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
    })
      .then((response) => response.json())
      .then((data) => (order = data.order))
      .catch((error) => console.error(error));
  
    return order;
  }