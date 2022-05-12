import { Entity, Column, PrimaryColumn } from "typeorm"
import { TileType } from "../modules/map/types"

@Entity()
export class Tile {

    @PrimaryColumn()
    id: string

    @Column()
    x: number

    @Column()
    y: number

    @Column({
        type: "enum",
        enum: TileType,
        default: TileType.UNOWNED
    })
    type: TileType

    @Column()
    top: boolean

    @Column()
    left: boolean

    @Column()
    topLeft: boolean

    @Column()
    updatedAt: number

    @Column({ nullable: true })
    name?: string

    @Column({ nullable: true })
    owner?: string

    @Column({ nullable: true })
    estateId?: string

    @Column({ nullable: true })
    tokenId?: string

    @Column({ nullable: true })
    price?: string

    @Column({ nullable: true })
    expiresAt?: string

}