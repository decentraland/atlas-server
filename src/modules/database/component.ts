import { IBaseComponent, IConfigComponent } from "@well-known-components/interfaces";
import { DataSource } from "typeorm";
import { Estate } from "../../entity/Estate";
import { LastSync } from "../../entity/LastSync";
import { Parcel } from "../../entity/Parcel";
import { Tile } from "../../entity/Tile";
import { IDatabaseComponent } from "./types";

export async function createDatabaseComponent(components: {
    config: IConfigComponent
}): Promise<IDatabaseComponent & IBaseComponent> {
    const { config } = components

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
            Tile,
        ],
        migrations: [],
        subscribers: [],
    })

    if (!dataSource.isInitialized) {
        console.log("initializing database...");
        await dataSource.initialize()
    }

    return {
        appDataSource: dataSource
    }
}