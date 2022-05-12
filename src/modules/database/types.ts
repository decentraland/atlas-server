import { DataSource } from "typeorm";

export interface IDatabaseComponent {
    appDataSource: DataSource
}