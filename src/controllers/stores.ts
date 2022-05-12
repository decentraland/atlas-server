import { Result } from '../modules/api/types'
import { MapEvents } from '../modules/map/types'
import { AppComponents } from '../types'
const axios = require('axios');

export const setupStores = (
  components: Pick<AppComponents, 'map'>
) => {
  const { map } = components

  map.events.on(MapEvents.READY, async (result: Result) => {
    console.log('stores - ready');
    
    const resp = await axios.post(
      "https://webhook.site/70045f5e-c378-4225-9319-49056b44287f",
      result
    );
  })

  map.events.on(MapEvents.UPDATE, async (result: Result) => {
    console.log('stores - update');
    
    const resp = await axios.post(
      "https://webhook.site/70045f5e-c378-4225-9319-49056b44287f",
      result
    );
  })

  map.events.on(MapEvents.ERROR, (error: Error) => {
    console.log(
      `Error: updating tiles
       ${error.message}
       ${error.stack}`
    )
  })
}
