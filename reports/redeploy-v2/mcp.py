import asyncio, json
from mcp.client import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import Implementation
async def main():
 for name,port in [('egg-node',8001),('egg-python',8000)]:
  async with streamable_http_client(f'http://10.8.0.11:{port}/mcp') as streams:
   async with ClientSession(streams[0],streams[1],client_info=Implementation(name='redeploy-v2-'+name,version='1.0')) as client:
    init=await client.initialize()
    catalog=await client.list_tools()
    assert len(catalog.tools)==15
    print(name,'initialize',init.server_info.model_dump(),'advertised',len(catalog.tools))
    print('CATALOG',name,json.dumps([{'name':t.name,'annotations':t.annotations.model_dump() if t.annotations else None} for t in catalog.tools]))
    for query in ['Mug','Shirt','Sticker']:
     result=await client.call_tool('search_products',{'query':query})
     assert not result.is_error
     print(name,'search_products',query,'is_error',result.is_error)
    try:
     result=await client.call_tool('redeploy_v2_unknown_tool',{})
     assert result.is_error
     print(name,'unknown-tool is_error',result.is_error)
    except Exception as error:
     print(name,'unknown-tool',type(error).__name__,str(error))
asyncio.run(main())
