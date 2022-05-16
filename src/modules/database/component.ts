import { IBaseComponent, IConfigComponent } from "@well-known-components/interfaces";
import EventEmitter from "events";
import { DataSource } from "typeorm";
import { Estate } from "../../entity/Estate";
import { LastSync } from "../../entity/LastSync";
import { Parcel } from "../../entity/Parcel";
import { Tile as TileEntity } from "../../entity/Tile";
import { ApiEvents, NFT } from "../api/types";
import { Tile } from "../map/types";
import { IDatabaseComponent } from "./types";

export async function createDatabaseComponent(components: {
    events: EventEmitter,
    config: IConfigComponent,
}): Promise<IDatabaseComponent & IBaseComponent> {
    const { events, config } = components

    const pgHost = await config.requireString('POSTGRES_HOST')
    const pgPort = await config.requireNumber('POSTGRES_PORT')
    const pgUser = await config.requireString('POSTGRES_USER')
    const pgPwd = await config.requireString('POSTGRES_PWD')
    const pgDbName = await config.requireString('POSTGRES_DB_NAME')

    const dataSource = new DataSource({
        type: "postgres",
        host: pgHost,
        port: pgPort,
        username: pgUser,
        password: pgPwd,
        database: pgDbName,
        synchronize: true,
        logging: false,
        entities: [
            LastSync,
            Parcel,
            Estate,
            TileEntity,
        ],
        migrations: [],
        subscribers: [],
    })

    if (!dataSource.isInitialized) {
        console.log("initializing database...");
        await dataSource.initialize()
    }

    events.on(ApiEvents.LAST_UPDATED_AT, async (updatedAt: number) => {
        const lastSyncRepo = await dataSource.getRepository(LastSync);
        let allLastSync = await lastSyncRepo.find({
            order: {
                id: "DESC"
            }
        });

        // take the latest if any
        let lastSync = allLastSync.length > 0 ? allLastSync[0] : null

        if (lastSync === null) {
            // create a new one
            lastSync = new LastSync()
            lastSync.lastSyncedAt = updatedAt
            await lastSyncRepo.save(lastSync)
        } else {
            await dataSource
                .createQueryBuilder()
                .update(LastSync)
                .set({ lastSyncedAt: updatedAt })
                .where("id = :id", { id: lastSync.id })
                .execute()
        }
    })

    events.on(ApiEvents.UNSAFE_INSERT_BATCH_TILES, async (_tiles: Tile[]) => {
        await dataSource
            .createQueryBuilder()
            .insert()
            .into(TileEntity)
            .values(_tiles.map<TileEntity>((_tile) => {
                let tile = new TileEntity()
                tile.id = _tile.id
                tile.x = _tile.x
                tile.y = _tile.y
                tile.type = _tile.type
                tile.top = _tile.top
                tile.left = _tile.left
                tile.topLeft = _tile.topLeft
                tile.updatedAt = _tile.updatedAt
                tile.name = _tile.name
                tile.owner = _tile.owner
                tile.estateId = _tile.estateId
                tile.tokenId = _tile.tokenId
                tile.price = _tile.price?.toString()
                tile.expiresAt = _tile.expiresAt?.toString()

                return tile
            }))
            .orIgnore()
            .execute()
    })

    events.on(ApiEvents.UNSAFE_INSERT_BATCH_PARCELS, async (_parcels: NFT[]) => {
        await dataSource
            .createQueryBuilder()
            .insert()
            .into(Parcel)
            .values(_parcels.map<NFT>((_parcel) => {
                let parcel = new Parcel()
                parcel.id = _parcel.id
                parcel.name = _parcel.name
                parcel.description = _parcel.description
                parcel.image = _parcel.image
                parcel.external_url = _parcel.external_url
                parcel.background_color = _parcel.background_color
                parcel.attributes = _parcel.attributes

                return parcel
            }))
            .orIgnore()
            .execute()
    })

    events.on(ApiEvents.UNSAFE_INSERT_BATCH_ESTATES, async (_estates: NFT[]) => {
        await dataSource
            .createQueryBuilder()
            .insert()
            .into(Estate)
            .values(_estates.map<NFT>((_parcel) => {
                let parcel = new Estate()
                parcel.id = _parcel.id
                parcel.name = _parcel.name
                parcel.description = _parcel.description
                parcel.image = _parcel.image
                parcel.external_url = _parcel.external_url
                parcel.background_color = _parcel.background_color
                parcel.attributes = _parcel.attributes

                return parcel
            }))
            .orIgnore()
            .execute()
    })

    events.on(ApiEvents.INSERT_OR_UPDATE_BATCH_TILES, async (_tiles: Tile[]) => {
        const tileRepo = await dataSource.getRepository(TileEntity)

        for (const _tile of _tiles) {
            // _tiles.forEach(async (_tile) => {
            let tile = await tileRepo.findOneBy({ id: _tile.id })
            if (tile === null) {
                // create new
                tile = new TileEntity()
            }
            // update
            tile.id = _tile.id
            tile.x = _tile.x
            tile.y = _tile.y
            tile.type = _tile.type
            tile.top = _tile.top
            tile.left = _tile.left
            tile.topLeft = _tile.topLeft
            tile.updatedAt = _tile.updatedAt
            tile.name = _tile.name
            tile.owner = _tile.owner
            tile.estateId = _tile.estateId
            tile.tokenId = _tile.tokenId
            tile.price = _tile.price?.toString()
            tile.expiresAt = _tile.expiresAt?.toString()
            await tileRepo.save(tile)
        }
        // })
    })

    events.on(ApiEvents.INSERT_OR_UPDATE_BATCH_PARCELS, async (_parcels: NFT[]) => {
        const parcelRepo = await dataSource.getRepository(Parcel)

        for (const _parcel of _parcels) {
            // _parcels.forEach(async (_parcel) => {
            let parcel = await parcelRepo.findOneBy({ id: _parcel.id })
            if (parcel === null) {
                // create new
                parcel = new Parcel()
            }
            // update
            parcel.id = _parcel.id
            parcel.name = _parcel.name
            parcel.description = _parcel.description
            parcel.image = _parcel.image
            parcel.external_url = _parcel.external_url
            parcel.background_color = _parcel.background_color
            parcel.attributes = _parcel.attributes
            await parcelRepo.save(parcel)
            // })
        }
    })

    events.on(ApiEvents.INSERT_OR_UPDATE_BATCH_ESTATES, async (_estates: NFT[]) => {
        const estateRepo = await dataSource.getRepository(Estate)

        for (const _estate of _estates) {
            let estate = await estateRepo.findOneBy({ id: _estate.id })
            if (estate === null) {
                // create new
                estate = new Estate()
            }
            // update
            estate.id = _estate.id
            estate.name = _estate.name
            estate.description = _estate.description
            estate.image = _estate.image
            estate.external_url = _estate.external_url
            estate.background_color = _estate.background_color
            estate.attributes = _estate.attributes
            await estateRepo.save(estate)
        }
    })

    return {
        appDataSource: dataSource
    }
}